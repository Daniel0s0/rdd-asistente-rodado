/**
 * agent.test.ts — Integration tests for src/api/agent.ts (POST /agent/chat)
 *
 * Strategy:
 *   - Spin up a minimal Express app with agentChatHandler mounted.
 *   - Mock claudeAgent (the singleton) so no real Claude API calls are made.
 *   - Test HTTP contract: status codes, response shape, error handling.
 *
 * Covered cases:
 *   - Valid request → 200 + AgentResponse data
 *   - Missing causa_id → 400 validation_error
 *   - Empty message → 400 validation_error
 *   - Missing message → 400 validation_error
 *   - Claude API error (ClaudeAPIError) → 500 claude_api_error
 *   - ValidationError from agent → 400 validation_error
 *   - TemporaryError from agent → 503 temporary_error
 *   - Response shape includes all required fields
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';

// ─── Mock claudeAgent BEFORE importing the handler ───────────────────────────
// vi.mock hoists this call so the module is mocked when agent.ts is loaded.
vi.mock('@agent/claude-agent', () => {
  const ValidationError = class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  };

  const ClaudeAPIError = class ClaudeAPIError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ClaudeAPIError';
    }
  };

  const TemporaryError = class TemporaryError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TemporaryError';
    }
  };

  const claudeAgent = {
    chat: vi.fn(),
  };

  return { claudeAgent, ValidationError, ClaudeAPIError, TemporaryError };
});

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'info',
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

import { agentChatHandler } from '@api/agent';
import { claudeAgent, ValidationError, ClaudeAPIError, TemporaryError } from '@agent/claude-agent';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Express app with agentChatHandler at POST /agent/chat. */
function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.post('/agent/chat', agentChatHandler);
  return app;
}

/** Canonical AgentResponse returned by the mock. */
const MOCK_AGENT_RESPONSE = {
  conversationId: '11111111-1111-1111-1111-111111111111',
  messageId: '22222222-2222-2222-2222-222222222222',
  assistantMessage: 'Acuerdo registrado correctamente.',
  intent: 'acuerdo' as const,
  extractedData: { monto: 1800000, cuotas: 12 },
  flags: [],
  shouldSyncSheets: true,
  sheetsSyncData: { action: 'UPDATE' as const, fields: { intent: 'acuerdo', monto: 1800000 } },
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('POST /agent/chat', () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('retorna 200 con AgentResponse cuando request es válido', async () => {
    vi.mocked(claudeAgent.chat).mockResolvedValue(MOCK_AGENT_RESPONSE);

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Hay acuerdo por $1.8M en 12 cuotas' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.timestamp).toBeDefined();
    expect(vi.mocked(claudeAgent.chat)).toHaveBeenCalledWith(
      '2024-00123',
      'Hay acuerdo por $1.8M en 12 cuotas'
    );
  });

  it('respuesta incluye todos los campos requeridos del AgentResponse', async () => {
    vi.mocked(claudeAgent.chat).mockResolvedValue(MOCK_AGENT_RESPONSE);

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Acuerdo confirmado' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.conversationId).toBe(MOCK_AGENT_RESPONSE.conversationId);
    expect(data.messageId).toBe(MOCK_AGENT_RESPONSE.messageId);
    expect(data.assistantMessage).toBe(MOCK_AGENT_RESPONSE.assistantMessage);
    expect(data.intent).toBe('acuerdo');
    expect(data.extractedData).toEqual({ monto: 1800000, cuotas: 12 });
    expect(data.flags).toEqual([]);
    expect(data.shouldSyncSheets).toBe(true);
    expect(data.sheetsSyncData).toBeDefined();
  });

  // ── Validation errors (400) ───────────────────────────────────────────────

  it('retorna 400 cuando falta causa_id', async () => {
    const response = await request(app)
      .post('/agent/chat')
      .send({ message: 'Hola' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('validation_error');
    expect(vi.mocked(claudeAgent.chat)).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando message está vacío', async () => {
    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: '' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('validation_error');
    expect(vi.mocked(claudeAgent.chat)).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando falta message', async () => {
    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('validation_error');
    expect(vi.mocked(claudeAgent.chat)).not.toHaveBeenCalled();
  });

  // ── Error propagation from agent ──────────────────────────────────────────

  it('retorna 500 con claude_api_error cuando ClaudeAPIError es lanzado', async () => {
    vi.mocked(claudeAgent.chat).mockRejectedValue(
      new ClaudeAPIError('Claude API auth error (status 401): Unauthorized')
    );

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Consulta de estado' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('claude_api_error');
  });

  it('retorna 400 con validation_error cuando ValidationError es lanzado por el agente', async () => {
    vi.mocked(claudeAgent.chat).mockRejectedValue(
      new ValidationError('No conversation found for causa_id "2024-00123"')
    );

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Consulta de estado' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('validation_error');
    expect(response.body.message).toContain('2024-00123');
  });

  it('retorna 503 con temporary_error cuando TemporaryError es lanzado', async () => {
    vi.mocked(claudeAgent.chat).mockRejectedValue(
      new TemporaryError('Claude API temporary error (status 429): Rate limited')
    );

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Consulta de estado' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('temporary_error');
  });

  it('retorna 500 con internal_error para errores inesperados', async () => {
    vi.mocked(claudeAgent.chat).mockRejectedValue(new Error('Unexpected database failure'));

    const response = await request(app)
      .post('/agent/chat')
      .send({ causa_id: '2024-00123', message: 'Consulta de estado' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('internal_error');
  });
});
