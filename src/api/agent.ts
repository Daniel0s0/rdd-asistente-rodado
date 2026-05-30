import { Request, Response } from 'express';
import { claudeAgent, ValidationError, ClaudeAPIError, TemporaryError } from '@agent/claude-agent';
import { logger } from '@utils/logger';
import { z } from 'zod';

const agentChatRequestSchema = z.object({
  causa_id: z.string().min(1, 'causa_id requerido'),
  message: z.string().min(1, 'message requerido y no puede estar vacío'),
});

export async function agentChatHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // 1. Validar input
    const validation = agentChatRequestSchema.safeParse(req.body);

    if (!validation.success) {
      const errors = validation.error.flatten().fieldErrors;
      const messages = Object.entries(errors)
        .map(([field, msgs]) => `${field}: ${msgs?.join(', ')}`)
        .join('; ');

      logger.warn({ errors: messages }, 'Agent chat validation failed');
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: `Input validation failed: ${messages}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { causa_id, message } = validation.data;

    logger.debug({ causaId: causa_id }, 'Agent chat request received');

    // 2. Llamar al agente
    const response = await claudeAgent.chat(causa_id, message);

    // 3. Loguear éxito
    logger.info(
      { causaId: causa_id, intent: response.intent, shouldSyncSheets: response.shouldSyncSheets },
      'Agent chat completed successfully'
    );

    // 4. Retornar respuesta
    res.status(200).json({
      success: true,
      data: {
        conversationId: response.conversationId,
        messageId: response.messageId,
        assistantMessage: response.assistantMessage,
        intent: response.intent,
        extractedData: response.extractedData,
        flags: response.flags,
        shouldSyncSheets: response.shouldSyncSheets,
        sheetsSyncData: response.sheetsSyncData,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const err = error as Error & { stack?: string };

    if (error instanceof ValidationError) {
      logger.warn({ error: err.message }, 'Validation error');
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: err.message,
        timestamp: new Date().toISOString(),
      });
    } else if (error instanceof ClaudeAPIError) {
      logger.error({ error: err.message }, 'Claude API error');
      res.status(500).json({
        success: false,
        error: 'claude_api_error',
        message: 'Error al comunicarse con la API de Claude',
        timestamp: new Date().toISOString(),
      });
    } else if (error instanceof TemporaryError) {
      logger.warn({ error: err.message }, 'Temporary error');
      res.status(503).json({
        success: false,
        error: 'temporary_error',
        message: 'Servicio temporalmente no disponible, por favor reintente',
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.error({ error: err.message, stack: err.stack }, 'Unexpected error');
      res.status(500).json({
        success: false,
        error: 'internal_error',
        message: 'Error interno del servidor',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
