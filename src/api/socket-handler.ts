import { Server, Socket } from 'socket.io';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import {
  claudeAgent,
  ValidationError,
  ClaudeAPIError,
  TemporaryError,
} from '@agent/claude-agent';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SocketJoinCasePayload,
  SocketSendMessagePayload,
  SocketLeaveCasePayload,
} from '@domain/agent';

type RDDSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RDDServer = Server<ClientToServerEvents, ServerToClientEvents>;

const processingMap = new Map<string, boolean>();

export function registerSocketHandlers(io: RDDServer): void {
  io.on('connection', (socket: RDDSocket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');

    socket.on('join_case', (payload) => handleJoinCase(socket, payload));
    socket.on('send_message', (payload) => {
      void handleSendMessage(socket, payload);
    });
    socket.on('leave_case', (payload) => handleLeaveCase(socket, payload));

    socket.on('disconnect', (reason) => {
      processingMap.delete(socket.id);
      logger.debug({ socketId: socket.id, reason }, 'Socket disconnected');
    });
  });
}

export function handleJoinCase(socket: RDDSocket, payload: SocketJoinCasePayload): void {
  const env = getEnv();

  if (!payload.causaId || !payload.apiKey) {
    socket.emit('error', {
      code: 'validation_error',
      message: 'causaId and apiKey are required',
    });
    return;
  }

  if (payload.apiKey !== env.UI_API_KEY) {
    logger.warn({ socketId: socket.id }, 'Socket auth failed: invalid API key');
    socket.emit('error', { code: 'auth_failed', message: 'Invalid API key' });
    return;
  }

  const room = `case:${payload.causaId}`;

  if (socket.rooms.has(room)) {
    socket.emit('joined', { causaId: payload.causaId });
    return;
  }

  void socket.join(room);
  logger.info({ socketId: socket.id, causaId: payload.causaId }, 'Socket joined room');
  socket.emit('joined', { causaId: payload.causaId });
}

export async function handleSendMessage(
  socket: RDDSocket,
  payload: SocketSendMessagePayload
): Promise<void> {
  if (!payload.causaId || !payload.message) {
    socket.emit('error', {
      code: 'validation_error',
      message: 'causaId and message are required',
    });
    return;
  }

  if (!socket.rooms.has(`case:${payload.causaId}`)) {
    socket.emit('error', {
      code: 'not_in_room',
      message: 'Must join case room before sending messages',
    });
    return;
  }

  if (processingMap.get(socket.id)) {
    socket.emit('error', {
      code: 'validation_error',
      message: 'A message is already being processed',
    });
    return;
  }

  processingMap.set(socket.id, true);

  try {
    const response = await claudeAgent.chatStream(
      payload.causaId,
      payload.message,
      (token) => {
        if (socket.connected) {
          socket.emit('message_token', { token });
        }
      }
    );

    if (socket.connected) {
      socket.emit('message_complete', {
        causaId: payload.causaId,
        assistantMessage: response.assistantMessage,
        intent: response.intent,
        shouldSyncSheets: response.shouldSyncSheets,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      socket.emit('error', { code: 'validation_error', message: err.message });
    } else if (err instanceof ClaudeAPIError) {
      socket.emit('error', { code: 'stream_error', message: 'Claude API error' });
    } else if (err instanceof TemporaryError) {
      socket.emit('error', {
        code: 'stream_error',
        message: 'Temporary error, please retry',
      });
    } else {
      logger.error({ socketId: socket.id, err }, 'Unexpected error in send_message');
      socket.emit('error', { code: 'internal_error', message: 'Internal server error' });
    }
  } finally {
    processingMap.delete(socket.id);
  }
}

export function handleLeaveCase(socket: RDDSocket, payload: SocketLeaveCasePayload): void {
  if (!payload.causaId) return;

  const room = `case:${payload.causaId}`;
  void socket.leave(room);
  logger.debug({ socketId: socket.id, causaId: payload.causaId }, 'Socket left room');
}
