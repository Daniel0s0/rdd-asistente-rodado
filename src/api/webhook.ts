import { Request, Response } from 'express';
import crypto from 'crypto';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { appendRegistroRow } from '@sheets/client';
import {
  createConversation,
  getConversationByCausaId,
  updateConversationMetadata,
  closeConversation,
} from '@database/models';
import {
  CausaWebhookPayload,
  CasoModificacionPayload,
  CasoCierrePayload,
  CasoEtapaPayload,
  RegistroRow,
} from '@domain/rdd';
import { createCaseFolder } from '@drive/client';

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

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
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

  return {
    causa_id: p.causa_id,
    cliente_id: typeof p.cliente_id === 'string' ? p.cliente_id : undefined,
    cliente_nombre: p.cliente_nombre,
    cliente_rut: typeof p.cliente_rut === 'string' ? p.cliente_rut : undefined,
    drive_folder_id: typeof p.drive_folder_id === 'string' ? p.drive_folder_id : undefined,
    demandado: typeof p.demandado === 'string' ? p.demandado : undefined,
    rit: typeof p.rit === 'string' ? p.rit : undefined,
    tribunal: typeof p.tribunal === 'string' ? p.tribunal : undefined,
  };
}

function validateModificacionPayload(payload: unknown): CasoModificacionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid payload');
  }

  const p = payload as Record<string, unknown>;

  if (!p.causa_id || typeof p.causa_id !== 'string') {
    throw new ValidationError('causa_id es requerido');
  }

  return {
    causa_id: p.causa_id,
    rit: typeof p.rit === 'string' ? p.rit : undefined,
    tribunal: typeof p.tribunal === 'string' ? p.tribunal : undefined,
    cambios: p.cambios !== null && typeof p.cambios === 'object' ? (p.cambios as Record<string, unknown>) : undefined,
    timestamp: typeof p.timestamp === 'string' ? p.timestamp : undefined,
  };
}

function validateCierrePayload(payload: unknown): CasoCierrePayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid payload');
  }

  const p = payload as Record<string, unknown>;

  if (!p.causa_id || typeof p.causa_id !== 'string') {
    throw new ValidationError('causa_id es requerido');
  }

  if (!p.sub_etapa || typeof p.sub_etapa !== 'string') {
    throw new ValidationError('sub_etapa es requerido');
  }

  const validSubEtapas = ['Acuerdo', 'Pago', 'Desistimiento', 'Caducada'];
  if (!validSubEtapas.includes(p.sub_etapa as string)) {
    throw new ValidationError(`sub_etapa inválida: ${p.sub_etapa}. Valores válidos: ${validSubEtapas.join(', ')}`);
  }

  return {
    causa_id: p.causa_id,
    sub_etapa: p.sub_etapa as CasoCierrePayload['sub_etapa'],
    fecha_cierre: typeof p.fecha_cierre === 'string' ? p.fecha_cierre : undefined,
    timestamp: typeof p.timestamp === 'string' ? p.timestamp : undefined,
  };
}

function validateEtapaPayload(payload: unknown): CasoEtapaPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid payload');
  }

  const p = payload as Record<string, unknown>;

  if (!p.causa_id || typeof p.causa_id !== 'string') {
    throw new ValidationError('causa_id es requerido');
  }

  if (!p.etapa_nueva || typeof p.etapa_nueva !== 'string') {
    throw new ValidationError('etapa_nueva es requerido');
  }

  return {
    causa_id: p.causa_id,
    etapa_nueva: p.etapa_nueva as CasoEtapaPayload['etapa_nueva'],
    sub_etapa_nueva: typeof p.sub_etapa_nueva === 'string' ? p.sub_etapa_nueva : undefined,
    etapa_anterior: typeof p.etapa_anterior === 'string' ? p.etapa_anterior : undefined,
    sub_etapa_anterior: typeof p.sub_etapa_anterior === 'string' ? p.sub_etapa_anterior : undefined,
    timestamp: typeof p.timestamp === 'string' ? p.timestamp : undefined,
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

    // 1. Crear carpetas en Drive (Phase 4)
    logger.debug({ causaId: causa.causa_id }, 'Creating Drive case folder structure');
    const driveFolder = await createCaseFolder(causa.causa_id);

    const registroRow: RegistroRow = {
      causaId: causa.causa_id,
      clienteNombre: causa.cliente_nombre,
      clienteRut: causa.cliente_rut,
      demandado: causa.demandado,
      rit: causa.rit,
      tribunal: causa.tribunal,
      driveFolderId: driveFolder.folderId,
      driveFolderUrl: driveFolder.webViewLink,
      fechaIngreso: new Date().toISOString(),
    };

    const sheetsRowId = await appendRegistroRow(registroRow);

    // Crear conversación en base de datos para habilitar multi-turn chat
    logger.debug({ causaId: causa.causa_id }, 'Creating conversation');
    const conversation = await createConversation(causa.causa_id, {
      cliente_nombre: causa.cliente_nombre,
      cliente_rut: causa.cliente_rut,
      demandado: causa.demandado,
      tribunal: causa.tribunal,
      rit: causa.rit,
      etapa: 'litigacion',
      drive_folder_id: driveFolder.folderId,
    });

    logger.info(
      {
        causaId: causa.causa_id,
        conversationId: conversation.id,
        driveFolderId: driveFolder.folderId,
        sheetsRowId,
      },
      'Webhook processed: causa, Drive folders, and conversation created'
    );

    res.status(201).json({
      success: true,
      causa_id: causa.causa_id,
      conversation_id: conversation.id,
      drive_folder_id: driveFolder.folderId,
      sheets_row_id: sheetsRowId,
      message: 'Causa registrada con carpetas en Drive. ¿Cuál es el resultado del juicio?',
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

/**
 * POST /webhook/caso-modificacion
 * SaaS webhook #2: actualiza RIT y tribunal en conversación.
 */
export async function webhookCasoModificacionHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const payload = req.body;

    validateWebhookSignature(req, payload);

    const modificacion = validateModificacionPayload(payload);

    // Obtener conversación existente
    const conversation = await getConversationByCausaId(modificacion.causa_id);
    if (!conversation) {
      throw new NotFoundError(`Causa ${modificacion.causa_id} no encontrada en DB`);
    }

    // Actualizar metadata con RIT y tribunal
    const updates: Record<string, unknown> = {};
    if (modificacion.rit) updates.rit = modificacion.rit;
    if (modificacion.tribunal) updates.tribunal = modificacion.tribunal;

    await updateConversationMetadata(conversation.id, updates);

    logger.info(
      { causaId: modificacion.causa_id, conversationId: conversation.id, updates },
      'Webhook caso-modificacion processed'
    );

    res.status(200).json({
      success: true,
      causa_id: modificacion.causa_id,
      message: 'Caso modificación registrado',
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
    } else if (error instanceof NotFoundError) {
      logger.warn(
        { error: error.message, action: 'webhook_not_found' },
        'Causa not found in DB'
      );
      res.status(404).json({
        success: false,
        error: 'not_found',
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

/**
 * POST /webhook/caso-cierre
 * SaaS webhook #3: maneja cierre de caso con sub_etapa.
 * Lógica: Acuerdo → mantener activa; Pago/Desistimiento/Caducada → cerrar
 */
export async function webhookCasoCierreHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const payload = req.body;

    validateWebhookSignature(req, payload);

    const cierre = validateCierrePayload(payload);

    // Obtener conversación existente
    const conversation = await getConversationByCausaId(cierre.causa_id);
    if (!conversation) {
      throw new NotFoundError(`Causa ${cierre.causa_id} no encontrada en DB`);
    }

    // Mapeo de sub_etapa SaaS → motivo_cierre RDD
    const CIERRE_MOTIVO_MAP: Record<CasoCierrePayload['sub_etapa'], string | null> = {
      Acuerdo: null,              // RDD mantiene activa, espera pagos
      Pago: 'pago_total',
      Desistimiento: 'desistimiento',
      Caducada: 'caducada',
    };

    const motivo = CIERRE_MOTIVO_MAP[cierre.sub_etapa];

    if (motivo === null) {
      // Cierre por Acuerdo: SaaS dice cerrada pero RDD mantiene activa
      await updateConversationMetadata(conversation.id, {
        sub_etapa_saas: 'Acuerdo',
      });
      logger.info(
        { causaId: cierre.causa_id },
        'Webhook caso-cierre: Acuerdo — mantener activa en RDD'
      );
      res.status(200).json({
        success: true,
        causa_id: cierre.causa_id,
        rdd_action: 'kept_active',
        message: 'Causa mantiene estado activo en RDD — esperando términos del acuerdo',
      });
    } else {
      // Cierre real: actualizar case_state y motivo_cierre
      await updateConversationMetadata(conversation.id, {
        case_state: 'cerrada',
        motivo_cierre: motivo as 'pago_total' | 'desistimiento' | 'caducada',
        sub_etapa_saas: cierre.sub_etapa,
      });
      await closeConversation(conversation.id, 'webhook_sistema');
      logger.info(
        { causaId: cierre.causa_id, motivo },
        'Webhook caso-cierre: causa cerrada'
      );
      res.status(200).json({
        success: true,
        causa_id: cierre.causa_id,
        rdd_action: 'closed',
        motivo_cierre: motivo,
        message: 'Causa cerrada en RDD',
      });
    }
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
    } else if (error instanceof NotFoundError) {
      logger.warn(
        { error: error.message, action: 'webhook_not_found' },
        'Causa not found in DB'
      );
      res.status(404).json({
        success: false,
        error: 'not_found',
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

/**
 * POST /webhook/caso-etapa
 * SaaS webhook: cambio de etapa o sub-etapa.
 * Litigacion → Cobranza, o cambio a sub-etapa que requiere acción del agente.
 */
export async function webhookCasoEtapaHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const payload = req.body;

    validateWebhookSignature(req, payload);

    const etapaCambio = validateEtapaPayload(payload);

    const conversation = await getConversationByCausaId(etapaCambio.causa_id);
    if (!conversation) {
      throw new NotFoundError(`Causa ${etapaCambio.causa_id} no encontrada en DB`);
    }

    // Mapear etapa del SaaS a RDD
    const etapaRdd = etapaCambio.etapa_nueva === 'Cobranza' ? 'cobranza' : 'litigacion';

    await updateConversationMetadata(conversation.id, {
      etapa: etapaRdd,
      sub_etapa_saas: etapaCambio.sub_etapa_nueva ?? null,
    });

    logger.info(
      {
        causaId: etapaCambio.causa_id,
        etapaNueva: etapaRdd,
        subEtapaNueva: etapaCambio.sub_etapa_nueva,
      },
      'Webhook caso-etapa processed'
    );

    res.status(200).json({
      success: true,
      causa_id: etapaCambio.causa_id,
      etapa: etapaRdd,
      message: 'Etapa actualizada',
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
    } else if (error instanceof NotFoundError) {
      logger.warn(
        { error: error.message, action: 'webhook_not_found' },
        'Causa not found in DB'
      );
      res.status(404).json({
        success: false,
        error: 'not_found',
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
