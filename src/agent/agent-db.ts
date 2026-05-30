/**
 * agent-db.ts — RDD Agent Database Wrappers
 *
 * Thin wrapper functions around models.ts for agent-specific DB operations.
 * Provides a clean interface for the agent to load context and persist messages
 * without coupling claude-agent.ts directly to the models layer.
 *
 * Exports exactly 4 functions:
 *   - loadConversationContext  — loads conversation + full history
 *   - saveAgentMessage         — persists assistant turn
 *   - saveUserMessage          — persists user turn
 *   - updateConversationState  — updates metadata after agreement/payment
 */

import { logger } from '@utils/logger';
import {
  getConversationByCausaId,
  getRecentMessages,
  createMessage,
  updateConversationMetadata,
} from '@database/models';
import { Conversation, Message, MessageMetadata } from '@database/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Context Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga el contexto de conversación para el procesamiento del agente.
 *
 * Retorna tanto el registro de conversación como su historial completo.
 * Cumple DI #3: carga SIEMPRE el historial completo (hasta maxContextTurns).
 *
 * @param causaId        - ID de la causa legal (e.g., "2024-00123")
 * @param maxContextTurns - Número máximo de mensajes a cargar (default 20)
 * @returns Conversación y mensajes recientes listos para enviar a Claude
 * @throws Error si no existe conversación para el causaId dado
 */
export async function loadConversationContext(
  causaId: string,
  maxContextTurns: number = 20
): Promise<{
  conversation: Conversation;
  recentMessages: Message[];
}> {
  logger.debug({ causaId, maxContextTurns }, 'Cargando contexto de conversación');

  const conversation = await getConversationByCausaId(causaId);
  if (!conversation) {
    throw new Error(`Conversación para causa_id "${causaId}" no encontrada`);
  }

  const recentMessages = await getRecentMessages(conversation.id, maxContextTurns);

  logger.debug(
    { causaId, conversationId: conversation.id, messageCount: recentMessages.length },
    'Contexto de conversación cargado'
  );

  return {
    conversation,
    recentMessages,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda el mensaje del agente (assistant) en la base de datos con metadata.
 *
 * Inserta atómicamente el mensaje y la entrada de audit log.
 *
 * @param conversationId  - ID de la conversación destino
 * @param assistantMessage - Texto de respuesta generado por Claude
 * @param metadata         - Metadata del mensaje (model, tokens, response_type, etc.)
 * @returns El mensaje creado con ID y timestamp asignados
 */
export async function saveAgentMessage(
  conversationId: string,
  assistantMessage: string,
  metadata: MessageMetadata
): Promise<Message> {
  logger.debug({ conversationId }, 'Guardando mensaje del agente');

  const message = await createMessage(
    conversationId,
    'assistant',
    assistantMessage,
    metadata
  );

  return message;
}

/**
 * Guarda el mensaje del usuario en la base de datos con el intent parseado.
 *
 * Inserta atómicamente el mensaje y la entrada de audit log.
 *
 * @param conversationId - ID de la conversación destino
 * @param userMessage    - Texto ingresado por el usuario
 * @param metadata       - Metadata del mensaje (intent, monto_extraido, etc.)
 * @returns El mensaje creado con ID y timestamp asignados
 */
export async function saveUserMessage(
  conversationId: string,
  userMessage: string,
  metadata: MessageMetadata
): Promise<Message> {
  logger.debug({ conversationId }, 'Guardando mensaje del usuario');

  const message = await createMessage(
    conversationId,
    'user',
    userMessage,
    metadata
  );

  return message;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actualiza el estado de la conversación cuando se registra un acuerdo o pago.
 *
 * Actualiza campos de top-level (acuerdo_monto, acuerdo_cuotas, etc.)
 * de forma atómica, registrando cambios en el audit log.
 *
 * @param conversationId - ID de la conversación a actualizar
 * @param updates        - Campos parciales de Conversation a actualizar
 * @returns La conversación actualizada
 */
export async function updateConversationState(
  conversationId: string,
  updates: Partial<Conversation>
): Promise<Conversation> {
  logger.debug({ conversationId, updates }, 'Actualizando estado de conversación');

  const updated = await updateConversationMetadata(conversationId, updates);
  return updated;
}
