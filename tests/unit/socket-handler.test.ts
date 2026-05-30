import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Socket } from 'socket.io';

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'silent',
    SAAS_WEBHOOK_SECRET: 'test_secret',
    SAAS_API_URL: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_MODEL: 'claude-3-5-sonnet-20241022',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'test-sheet-id',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'test-folder-id',
    DATABASE_TYPE: 'sqlite',
    DATABASE_PATH: ':memory:',
    CLAUDE_MAX_CONTEXT_TURNS: 10,
    CLAUDE_TEMPERATURE: 0.3,
    GOOGLE_API_TIMEOUT: 30000,
    GOOGLE_API_MAX_RETRIES: 3,
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_DETAILED_LOGGING: false,
  }),
}));

vi.mock('@agent/claude-agent', () => {
  const ValidationError = class extends Error {
    name = 'ValidationError';
  };
  const ClaudeAPIError = class extends Error {
    name = 'ClaudeAPIError';
  };
  const TemporaryError = class extends Error {
    name = 'TemporaryError';
  };

  return {
    claudeAgent: {
      chatStream: vi.fn(),
    },
    ValidationError,
    ClaudeAPIError,
    TemporaryError,
  };
});

import { handleJoinCase, handleSendMessage, handleLeaveCase } from '@api/socket-handler';
import * as agent from '@agent/claude-agent';

const claudeAgent = vi.mocked(agent.claudeAgent);

function createMockSocket(preJoinedRooms: string[] = []) {
  const rooms = new Set<string>(['test-socket-id', ...preJoinedRooms]);
  return {
    id: 'test-socket-id',
    rooms,
    connected: true,
    emit: vi.fn(),
    join: vi.fn((room: string) => {
      rooms.add(room);
      return Promise.resolve();
    }),
    leave: vi.fn((room: string) => {
      rooms.delete(room);
      return Promise.resolve();
    }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Socket;
}

const MOCK_AGENT_RESPONSE = {
  conversationId: 'conv-123',
  messageId: 'msg-123',
  assistantMessage: 'Respuesta de Claude',
  intent: 'consulta' as const,
  extractedData: undefined,
  flags: [],
  shouldSyncSheets: false,
  sheetsSyncData: undefined,
};

describe('Socket Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleJoinCase', () => {
    it('emits joined and calls socket.join when credentials valid', async () => {
      const socket = createMockSocket();
      const payload = { causaId: '2024-00001', apiKey: 'test_api_key_min_32_chars_long_enough' };

      handleJoinCase(socket as any, payload);

      expect(socket.join).toHaveBeenCalledWith('case:2024-00001');
      expect(socket.emit).toHaveBeenCalledWith('joined', { causaId: '2024-00001' });
    });

    it('emits validation_error when fields missing', () => {
      const socket = createMockSocket();
      const payload = { causaId: '', apiKey: '' };

      handleJoinCase(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'validation_error',
        message: 'causaId and apiKey are required',
      });
    });

    it('emits auth_failed when API key invalid', () => {
      const socket = createMockSocket();
      const payload = { causaId: '2024-00001', apiKey: 'wrong_key' };

      handleJoinCase(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'auth_failed',
        message: 'Invalid API key',
      });
    });

    it('emits joined idempotently when already in room', () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001', apiKey: 'test_api_key_min_32_chars_long_enough' };

      handleJoinCase(socket as any, payload);

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('joined', { causaId: '2024-00001' });
    });
  });

  describe('handleSendMessage', () => {
    it('emits not_in_room when socket not in case room', async () => {
      const socket = createMockSocket();
      const payload = { causaId: '2024-00001', message: 'Hola' };

      await handleSendMessage(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'not_in_room',
        message: 'Must join case room before sending messages',
      });
    });

    it('calls chatStream and emits tokens then message_complete', async () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001', message: 'Hola' };

      claudeAgent.chatStream.mockResolvedValue(MOCK_AGENT_RESPONSE);

      await handleSendMessage(socket as any, payload);

      expect(claudeAgent.chatStream).toHaveBeenCalledWith(
        '2024-00001',
        'Hola',
        expect.any(Function)
      );

      const onTokenCallback = (claudeAgent.chatStream as any).mock.calls[0][2];
      onTokenCallback('Hola ');
      onTokenCallback('¿cómo ');
      onTokenCallback('estás?');

      expect(socket.emit).toHaveBeenCalledWith('message_token', { token: 'Hola ' });
      expect(socket.emit).toHaveBeenCalledWith('message_token', { token: '¿cómo ' });
      expect(socket.emit).toHaveBeenCalledWith('message_token', { token: 'estás?' });
      expect(socket.emit).toHaveBeenCalledWith(
        'message_complete',
        expect.objectContaining({
          causaId: '2024-00001',
          assistantMessage: 'Respuesta de Claude',
          intent: 'consulta',
          shouldSyncSheets: false,
        })
      );
    });

    it('emits validation_error when ValidationError thrown', async () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001', message: 'Test' };

      const validationErr = new agent.ValidationError('Bad data');
      claudeAgent.chatStream.mockRejectedValue(validationErr);

      await handleSendMessage(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'validation_error',
        message: 'Bad data',
      });
    });

    it('emits stream_error when TemporaryError thrown', async () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001', message: 'Test' };

      const tempErr = new agent.TemporaryError('Rate limited');
      claudeAgent.chatStream.mockRejectedValue(tempErr);

      await handleSendMessage(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'stream_error',
        message: 'Temporary error, please retry',
      });
    });

    it('emits validation_error when message is empty', async () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001', message: '' };

      await handleSendMessage(socket as any, payload);

      expect(socket.emit).toHaveBeenCalledWith('error', {
        code: 'validation_error',
        message: 'causaId and message are required',
      });
    });
  });

  describe('handleLeaveCase', () => {
    it('calls socket.leave with case room', () => {
      const socket = createMockSocket(['case:2024-00001']);
      const payload = { causaId: '2024-00001' };

      handleLeaveCase(socket as any, payload);

      expect(socket.leave).toHaveBeenCalledWith('case:2024-00001');
    });

    it('does nothing when causaId missing', () => {
      const socket = createMockSocket();
      const payload = { causaId: '' };

      handleLeaveCase(socket as any, payload);

      expect(socket.leave).not.toHaveBeenCalled();
    });
  });
});
