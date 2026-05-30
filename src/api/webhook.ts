import { Request, Response } from 'express';
import crypto from 'crypto';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { appendRegistroRow } from '@sheets/client';
import { createConversation } from '@database/models';
import { CausaWebhookPayload, RegistroRow } from '@domain/rdd';

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function validateWebhookSignature(req: Request, body: unknown): void {
  const signature = req.headers['x-webhook-signature'];

  if (!signature || typeof signature !== 'string') {
    throw new UnauthorizedError('Missing webhook signature');
  }

  const env = getEnv();
  const bodyJson = JSON.stringify(body);
  const computed = crypto
    .createHmac('sha256', env.SAAS_WEBHOOK_SECRET)
    .update(bodyJson)
    .digest('hex');

  if (signature.length !== computed.length) {
    throw new UnauthorizedError('Invalid webhook signature');
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    throw new UnauthorizedError('Invalid webhook signature');
  }
}

function validateCausaPayload(payload: unknown): CausaWebhookPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid payload');
  }

  const p = payload as Record<string, unknown>;

  if (!p.causa_id || typeof p.causa_id !== 'string') {
    throw new ValidationError('causa_id es requerido');
  }

  if (!p.cliente_nombre || typeof p.cliente_nombre !== 'string') {
    throw new ValidationError('cliente_nombre es requerido');
  }

  if (!p.drive_folder_id || typeof p.drive_folder_id !== 'string') {
    throw new ValidationError('drive_folder_id es requerido');
  }

  return {
    causa_id: p.causa_id,
    cliente_id: typeof p.cliente_id === 'string' ? p.cliente_id : undefined,
    cliente_nombre: p.cliente_nombre,
    cliente_rut: typeof p.cliente_rut === 'string' ? p.cliente_rut : undefined,
    drive_folder_id: p.drive_folder_id,
    demandado: typeof p.demandado === 'string' ? p.demandado : undefined,
    rit: typeof p.rit === 'string' ? p.rit : undefined,
    tribunal: typeof p.tribunal === 'string' ? p.tribunal : undefined,
  };
}

export async function webhookCausaNuevaHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const payload = req.body;

    validateWebhookSignature(req, payload);

    const causa = validateCausaPayload(payload);

    const registroRow: RegistroRow = {
      causaId: causa.causa_id,
      clienteNombre: causa.cliente_nombre,
      clienteRut: causa.cliente_rut,
      demandado: causa.demandado,
      rit: causa.rit,
      tribunal: causa.tribunal,
      driveFolderId: causa.drive_folder_id,
      fechaIngreso: new Date().toISOString(),
    };

    const sheetsRowId = await appendRegistroRow(registroRow);

    // Crear conversación en base de datos para habilitar multi-turn chat
    logger.debug({ causaId: causa.causa_id }, 'Creating conversation');
    const conversation = await createConversation(causa.causa_id, {
      demandado: causa.demandado,
      tribunal: causa.tribunal,
      rit: causa.rit,
      etapa: 'litigacion',
    });

    logger.info(
      {
        causaId: causa.causa_id,
        conversationId: conversation.id,
        sheetsRowId,
      },
      'Webhook processed: causa and conversation created'
    );

    res.status(201).json({
      success: true,
      causa_id: causa.causa_id,
      conversation_id: conversation.id,
      sheets_row_id: sheetsRowId,
      message: 'Causa registrada. ¿Cuál es el resultado del juicio?',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      logger.warn(
        { error: error.message, action: 'webhook_auth_failed' },
        'Webhook signature validation failed'
      );
      res.status(401).json({
        success: false,
        error: 'invalid_signature',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } else if (error instanceof ValidationError) {
      logger.warn(
        { error: error.message, action: 'webhook_validation_failed' },
        'Webhook payload validation failed'
      );
      res.status(400).json({
        success: false,
        error: 'validation_error',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.error({ error, action: 'webhook_internal_error' }, 'Webhook processing failed');
      res.status(500).json({
        success: false,
        error: 'internal_error',
        message: 'Error procesando webhook',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
