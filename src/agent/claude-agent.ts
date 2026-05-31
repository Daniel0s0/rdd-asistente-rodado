/**
 * claude-agent.ts — RDD Claude Agent (Singleton)
 *
 * Core Claude integration for multi-turn legal case conversations.
 * Orchestrates: conversation loading → intent parsing → Claude API call →
 * response parsing → financial validation → DB persistence → Sheets sync prep.
 *
 * Usage:
 *   import { claudeAgent } from '@agent/claude-agent';
 *   const response = await claudeAgent.chat(causaId, userMessage);
 */

import { Anthropic, APIError as AnthropicAPIError } from '@anthropic-ai/sdk';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import {
  getConversationByCausaId,
  getRecentMessages,
  createMessage,
  updateConversationMetadata,
  createAcuerdo,
  createCuotas,
  createRegistro,
  markCuotaPagada,
  getAcuerdosActivos,
} from '@database/models';
import { Conversation } from '@database/schema';
import { AgentResponse, SheetsSyncData } from '@domain/agent';
import {
  parseUserIntent,
  extractFinancialData,
  validateFinancialData,
  ValidationError as ParserValidationError,
  FinancialData,
  Intent,
} from './message-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when input fails validation (empty causa_id, bad request to Claude, etc.) */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when Claude API returns an auth or permission error (401/403). */
export class ClaudeAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

/**
 * Thrown on transient failures (429 rate limit, 5xx server errors).
 * The HTTP layer should respond with 503 so the client can retry.
 */
export class TemporaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemporaryError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic error shape (SDK may wrap errors differently)
// ─────────────────────────────────────────────────────────────────────────────

interface AnthropicAPIError extends Error {
  status?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Actions (Fase 6.2)
// ─────────────────────────────────────────────────────────────────────────────

function calculateCuotaDates(
  fechaPrimerPago: string,
  cuotasTotal: number
): string[] {
  const dates: string[] = [];
  const firstDate = new Date(fechaPrimerPago);

  for (let i = 0; i < cuotasTotal; i++) {
    const date = new Date(firstDate);
    date.setMonth(date.getMonth() + i);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }

  return dates;
}

async function executeSuperparserAction(
  conversationId: string,
  intent: Intent,
  financialData: FinancialData
): Promise<void> {
  if (intent === 'acuerdo' && financialData.monto && financialData.cuotas && financialData.fecha) {
    const montoPorCuota = financialData.monto / financialData.cuotas;
    const acuerdo = await createAcuerdo({
      conversationId,
      montoTotal: financialData.monto,
      cuotasTotal: financialData.cuotas,
      montoPorCuota,
      porcentajeHonorarios: financialData.porcentajeHonorarios ?? 0,
      fechaPrimerPago: financialData.fecha,
    });

    const cuotaDates = calculateCuotaDates(financialData.fecha, financialData.cuotas);
    const cuotasToCreate = cuotaDates.map((fecha, idx) => ({
      numero: idx + 1,
      monto: montoPorCuota,
      fechaVencimiento: fecha,
    }));

    await createCuotas(acuerdo.id, cuotasToCreate);
    logger.info({ conversationId, acuerdoId: acuerdo.id }, 'Acuerdo + cuotas created in Supabase');
  } else if (intent === 'pago' && financialData.monto && financialData.fecha) {
    const acuerdosActivos = await getAcuerdosActivos(conversationId);

    if (acuerdosActivos.length > 0) {
      const acuerdo = acuerdosActivos[0];
      const numeroCuota = 1;
      await markCuotaPagada(acuerdo.id, numeroCuota, financialData.fecha);
      logger.info({ conversationId, acuerdoId: acuerdo.id }, 'Cuota marked as paid in Supabase');
    } else {
      const tipo =
        financialData.monto > 0 && !financialData.cuotas ? 'cobranza' : 'sentencia';
      await createRegistro({
        conversationId,
        tipo,
        monto: financialData.monto,
        fecha: financialData.fecha,
      });
      logger.info({ conversationId }, 'Registro created in Supabase');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ClaudeAgent
// ─────────────────────────────────────────────────────────────────────────────

export class ClaudeAgent {
  private static instance: ClaudeAgent | null = null;
  private readonly client: Anthropic;

  private constructor() {
    const env = getEnv();
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  /**
   * Singleton factory.
   * Initialises the Anthropic client once and reuses it across calls.
   */
  static getInstance(): ClaudeAgent {
    if (!ClaudeAgent.instance) {
      ClaudeAgent.instance = new ClaudeAgent();
    }
    return ClaudeAgent.instance;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: chat
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Main conversation orchestrator.
   *
   * Flow (spec §8):
   *  1.  Validate input
   *  2.  Load conversation from DB
   *  3.  Load full message history (DI #3)
   *  4.  Parse user intent
   *  5.  Save user message (atomic + audit via createMessage)
   *  6.  Build messages array for Claude
   *  7.  Call Claude SDK
   *  8.  Parse assistant response
   *  9.  Validate financial data (DI #7)
   * 10.  Save assistant message (atomic + audit)
   * 11.  Update conversation metadata if agreement/payment
   * 12.  Return AgentResponse
   *
   * @param causaId     - Legal case identifier (must be non-empty).
   * @param userMessage - Text from the user (must be non-empty).
   * @returns Structured AgentResponse with Sheets sync data when relevant.
   */
  async chat(causaId: string, userMessage: string): Promise<AgentResponse> {
    const env = getEnv();

    // ── 1. Validate input ────────────────────────────────────────────────────
    if (!causaId || causaId.trim() === '') {
      throw new ValidationError('causa_id is required and must not be empty');
    }
    if (!userMessage || userMessage.trim() === '') {
      throw new ValidationError('userMessage is required and must not be empty');
    }

    logger.info({ causaId }, 'ClaudeAgent.chat: starting');

    // ── 2. Load conversation ─────────────────────────────────────────────────
    const conversation = await getConversationByCausaId(causaId);
    if (!conversation) {
      throw new ValidationError(`No conversation found for causa_id "${causaId}"`);
    }

    // ── 3. Load full message history (DI #3) ─────────────────────────────────
    const recentMessages = await getRecentMessages(
      conversation.id,
      env.CLAUDE_MAX_CONTEXT_TURNS
    );

    logger.debug(
      { conversationId: conversation.id, historyCount: recentMessages.length },
      'ClaudeAgent.chat: history loaded'
    );

    // ── 4. Parse user intent ─────────────────────────────────────────────────
    const userIntent: Intent = parseUserIntent(userMessage);
    logger.debug({ userIntent }, 'ClaudeAgent.chat: intent parsed');

    // ── 5. Save user message (atomic + audit) ────────────────────────────────
    const userDbMessage = await createMessage(
      conversation.id,
      'user',
      userMessage,
      { intent: userIntent }
    );

    // ── 6. Build messages array for Claude ───────────────────────────────────
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
      recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Append the new user message (already saved; include in prompt)
    claudeMessages.push({ role: 'user', content: userMessage });

    // ── 7. Call Claude SDK ───────────────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(conversation);

    let claudeResponse: Awaited<ReturnType<typeof this.client.messages.create>>;
    try {
      claudeResponse = await this.client.messages.create({
        model: env.CLAUDE_MODEL,
        system: systemPrompt,
        messages: claudeMessages,
        max_tokens: 2048,
        temperature: env.CLAUDE_TEMPERATURE,
      });
    } catch (err) {
      const apiErr = err as AnthropicAPIError;
      const status = apiErr.status;
      logger.error({ causaId, status, error: apiErr.message }, 'ClaudeAgent.chat: Claude API error');

      if (status === 429 || (status !== undefined && status >= 500)) {
        throw new TemporaryError(`Claude API temporary error (status ${status}): ${apiErr.message}`);
      }
      if (status === 401 || status === 403) {
        throw new ClaudeAPIError(`Claude API auth error (status ${status}): ${apiErr.message}`);
      }
      if (status === 400) {
        throw new ValidationError(`Claude API bad request (status 400): ${apiErr.message}`);
      }
      throw err;
    }

    // Extract text from first content block
    const contentBlock = claudeResponse.content[0];
    const assistantContent =
      contentBlock && contentBlock.type === 'text' ? contentBlock.text : '';

    // ── 8. Parse assistant response ──────────────────────────────────────────
    const { intent: parsedIntent, data: financialData } = this.parseAssistantResponse(
      assistantContent,
      userIntent
    );

    const responseType = this.determineResponseType(assistantContent);
    const flags = this.extractFlags(assistantContent);

    // ── 9. Validate financial data (DI #7) ───────────────────────────────────
    if (financialData && Object.keys(financialData).length > 0) {
      try {
        validateFinancialData(financialData);
      } catch (validationErr) {
        if (validationErr instanceof ParserValidationError) {
          throw new ValidationError(validationErr.message);
        }
        throw validationErr;
      }
    }

    // ── 9.5 Execute Supabase actions (Fase 6.2) ───────────────────────────────
    if (
      financialData &&
      Object.keys(financialData).length > 0 &&
      (parsedIntent === 'acuerdo' || parsedIntent === 'pago')
    ) {
      try {
        await executeSuperparserAction(conversation.id, parsedIntent, financialData);
      } catch (err) {
        logger.error(
          { conversationId: conversation.id, intent: parsedIntent, error: err instanceof Error ? err.message : String(err) },
          'ClaudeAgent.chat: Supabase action failed'
        );
        throw err;
      }
    }

    // ── 10. Save assistant message (atomic + audit) ───────────────────────────
    const tokensUsed = {
      input: claudeResponse.usage.input_tokens,
      output: claudeResponse.usage.output_tokens,
    };

    const assistantDbMessage = await createMessage(
      conversation.id,
      'assistant',
      assistantContent,
      {
        response_type: responseType,
        processing_ok: true,
        flags,
        model: claudeResponse.model,
        tokens_used: tokensUsed,
      }
    );

    // ── 11. Update conversation state if agreement/payment ─────────────────
    const shouldSyncSheets = parsedIntent === 'acuerdo' || parsedIntent === 'pago';

    if (shouldSyncSheets && financialData) {
      const updates: Partial<Conversation> = {};

      if (financialData.monto !== undefined) {
        updates.acuerdo_monto = financialData.monto;
      }
      if (financialData.cuotas !== undefined) {
        updates.acuerdo_cuotas = financialData.cuotas;
      }

      if (Object.keys(updates).length > 0) {
        await updateConversationMetadata(conversation.id, updates);
        logger.debug(
          { conversationId: conversation.id, updates },
          'ClaudeAgent.chat: conversation updated'
        );
      }
    }

    // ── 12. Build Sheets sync data if needed ──────────────────────────────────
    const sheetsSyncData: SheetsSyncData | undefined = shouldSyncSheets && financialData
      ? this.buildSheetsSyncData(parsedIntent, financialData)
      : undefined;

    logger.info(
      {
        causaId,
        conversationId: conversation.id,
        userMessageId: userDbMessage.id,
        assistantMessageId: assistantDbMessage.id,
        intent: parsedIntent,
        shouldSyncSheets,
      },
      'ClaudeAgent.chat: complete'
    );

    // ── Return AgentResponse ──────────────────────────────────────────────────
    return {
      conversationId: conversation.id,
      messageId: assistantDbMessage.id,
      assistantMessage: assistantContent,
      intent: parsedIntent,
      extractedData: financialData && Object.keys(financialData).length > 0
        ? financialData
        : undefined,
      flags,
      shouldSyncSheets,
      sheetsSyncData,
    };
  }

  /**
   * Stream-based conversation orchestrator (Phase 5.2).
   *
   * Same flow as chat() (steps 1-6, 8-12) but diverges at step 7:
   * Uses messages.stream() instead of messages.create() to emit tokens in real-time.
   *
   * @param causaId     - Legal case identifier (must be non-empty).
   * @param userMessage - Text from the user (must be non-empty).
   * @param onToken     - Callback invoked for each token from Claude.
   * @returns Structured AgentResponse with Sheets sync data when relevant.
   */
  async chatStream(
    causaId: string,
    userMessage: string,
    onToken: (token: string) => void
  ): Promise<AgentResponse> {
    const env = getEnv();

    // ── 1. Validate input ────────────────────────────────────────────────────
    if (!causaId || causaId.trim() === '') {
      throw new ValidationError('causa_id is required and must not be empty');
    }
    if (!userMessage || userMessage.trim() === '') {
      throw new ValidationError('userMessage is required and must not be empty');
    }

    logger.info({ causaId }, 'ClaudeAgent.chatStream: starting');

    // ── 2. Load conversation ─────────────────────────────────────────────────
    const conversation = await getConversationByCausaId(causaId);
    if (!conversation) {
      throw new ValidationError(`No conversation found for causa_id "${causaId}"`);
    }

    // ── 3. Load full message history (DI #3) ─────────────────────────────────
    const recentMessages = await getRecentMessages(
      conversation.id,
      env.CLAUDE_MAX_CONTEXT_TURNS
    );

    logger.debug(
      { conversationId: conversation.id, historyCount: recentMessages.length },
      'ClaudeAgent.chatStream: history loaded'
    );

    // ── 4. Parse user intent ─────────────────────────────────────────────────
    const userIntent: Intent = parseUserIntent(userMessage);
    logger.debug({ userIntent }, 'ClaudeAgent.chatStream: intent parsed');

    // ── 5. Save user message (atomic + audit) ────────────────────────────────
    const userDbMessage = await createMessage(
      conversation.id,
      'user',
      userMessage,
      { intent: userIntent }
    );

    // ── 6. Build messages array for Claude ───────────────────────────────────
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
      recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    claudeMessages.push({ role: 'user', content: userMessage });

    // ── 7. Call Claude SDK with streaming ───────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(conversation);

    let assistantContent = '';
    let finalMessage: Awaited<ReturnType<typeof this.client.messages.create>>;

    try {
      const stream = this.client.messages.stream({
        model: env.CLAUDE_MODEL,
        system: systemPrompt,
        messages: claudeMessages,
        max_tokens: 2048,
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          assistantContent += event.delta.text;
          onToken(event.delta.text);
        }
      }

      finalMessage = await stream.finalMessage();
    } catch (err: unknown) {
      const apiErr = err instanceof AnthropicAPIError ? err : null;
      const status = apiErr?.status;
      const errorMessage = apiErr?.message || (err instanceof Error ? err.message : 'Unknown error');

      logger.error(
        { causaId, status, error: errorMessage },
        'ClaudeAgent.chatStream: Claude API error'
      );

      if (status === 429 || (status !== undefined && status >= 500)) {
        throw new TemporaryError(
          `Claude API temporary error (status ${status}): ${errorMessage}`
        );
      }
      if (status === 401 || status === 403) {
        throw new ClaudeAPIError(
          `Claude API auth error (status ${status}): ${errorMessage}`
        );
      }
      if (status === 400) {
        throw new ValidationError(`Claude API bad request (status 400): ${errorMessage}`);
      }
      throw err;
    }

    // ── 8. Parse assistant response ──────────────────────────────────────────
    const { intent: parsedIntent, data: financialData } = this.parseAssistantResponse(
      assistantContent,
      userIntent
    );

    const responseType = this.determineResponseType(assistantContent);
    const flags = this.extractFlags(assistantContent);

    // ── 9. Validate financial data (DI #7) ───────────────────────────────────
    if (financialData && Object.keys(financialData).length > 0) {
      try {
        validateFinancialData(financialData);
      } catch (validationErr) {
        if (validationErr instanceof ParserValidationError) {
          throw new ValidationError(validationErr.message);
        }
        throw validationErr;
      }
    }

    // ── 9.5 Execute Supabase actions (Fase 6.2) ───────────────────────────────
    if (
      financialData &&
      Object.keys(financialData).length > 0 &&
      (parsedIntent === 'acuerdo' || parsedIntent === 'pago')
    ) {
      try {
        await executeSuperparserAction(conversation.id, parsedIntent, financialData);
      } catch (err) {
        logger.error(
          { conversationId: conversation.id, intent: parsedIntent, error: err instanceof Error ? err.message : String(err) },
          'ClaudeAgent.chatStream: Supabase action failed'
        );
        throw err;
      }
    }

    // ── 10. Save assistant message (atomic + audit) ───────────────────────────
    const tokensUsed = {
      input: finalMessage.usage.input_tokens,
      output: finalMessage.usage.output_tokens,
    };

    const assistantDbMessage = await createMessage(
      conversation.id,
      'assistant',
      assistantContent,
      {
        response_type: responseType,
        processing_ok: true,
        flags,
        model: finalMessage.model,
        tokens_used: tokensUsed,
      }
    );

    // ── 11. Update conversation state if agreement/payment ─────────────────
    const shouldSyncSheets = parsedIntent === 'acuerdo' || parsedIntent === 'pago';

    if (shouldSyncSheets && financialData) {
      const updates: Partial<Conversation> = {};

      if (financialData.monto !== undefined) {
        updates.acuerdo_monto = financialData.monto;
      }
      if (financialData.cuotas !== undefined) {
        updates.acuerdo_cuotas = financialData.cuotas;
      }

      if (Object.keys(updates).length > 0) {
        await updateConversationMetadata(conversation.id, updates);
        logger.debug(
          { conversationId: conversation.id, updates },
          'ClaudeAgent.chatStream: conversation updated'
        );
      }
    }

    // ── 12. Build Sheets sync data if needed ──────────────────────────────────
    const sheetsSyncData: SheetsSyncData | undefined =
      shouldSyncSheets && financialData
        ? this.buildSheetsSyncData(parsedIntent, financialData)
        : undefined;

    logger.info(
      {
        causaId,
        conversationId: conversation.id,
        userMessageId: userDbMessage.id,
        assistantMessageId: assistantDbMessage.id,
        intent: parsedIntent,
        shouldSyncSheets,
      },
      'ClaudeAgent.chatStream: complete'
    );

    // ── Return AgentResponse ──────────────────────────────────────────────────
    return {
      conversationId: conversation.id,
      messageId: assistantDbMessage.id,
      assistantMessage: assistantContent,
      intent: parsedIntent,
      extractedData:
        financialData && Object.keys(financialData).length > 0
          ? financialData
          : undefined,
      flags,
      shouldSyncSheets,
      sheetsSyncData,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build the system prompt for Claude using case information.
   * Includes demandado, monto_demanda, tribunal, and rit when available.
   */
  private buildSystemPrompt(conversation: Conversation): string {
    const demandado = conversation.demandado ?? '(no especificado)';
    const montoDemanda = conversation.monto_demanda != null
      ? `$${conversation.monto_demanda.toLocaleString('es-CL')}`
      : '(no especificado)';
    const tribunal = conversation.tribunal ?? '(no especificado)';
    const rit = conversation.rit ?? '(no especificado)';
    const etapa = conversation.etapa ?? '(no especificada)';

    return `Eres RDD (Asistente Rodado), un agente contable especializado en el registro de ingresos de causas legales para un bufete de abogados.

CONTEXTO DE LA CAUSA:
- Demandado: ${demandado}
- Monto demandado: ${montoDemanda}
- Tribunal: ${tribunal}
- RIT: ${rit}
- Etapa: ${etapa}

ROL:
Ayudas al equipo del bufete a registrar resultados de causas: acuerdos, pagos recibidos, cierres y consultas sobre el estado del caso. Conversas en español con tono profesional.

EXTRACCIÓN DE DATOS:
Cuando el usuario mencione datos financieros, extráelos y repítelosen el formato:
[DATOS EXTRAIDOS]
- monto: <número>
- cuotas: <número> (si aplica)
- fecha: <YYYY-MM-DD> (si aplica)
- porcentajeHonorarios: <número> (si aplica)
[/DATOS EXTRAIDOS]

CIERRE DE CAUSA:
Si el usuario confirma el cierre del caso, incluye exactamente:
[CIERRE]

ADVERTENCIAS Y NOTAS:
Cuando detectes datos inconsistentes o faltantes, usa:
ADVERTENCIA: <mensaje>
NOTA: <mensaje>

RESTRICCIONES:
- Solo acepta montos > 0 y porcentajes entre 0–100%.
- Las fechas deben ser futuras o de hoy.
- Si falta información esencial, pregunta antes de asumir.
- Confirma siempre lo que registraste antes de continuar.`;
  }

  /**
   * Parse the assistant response to extract intent and financial data.
   *
   * Looks for [DATOS EXTRAIDOS] blocks and [CIERRE] markers.
   * Falls back to extractFinancialData() on the whole response if no block found.
   *
   * @param content    - Raw text from Claude.
   * @param userIntent - Intent detected from the user message.
   * @returns { intent, data } where data may be empty.
   */
  private parseAssistantResponse(
    content: string,
    userIntent: Intent
  ): { intent: Intent; data?: FinancialData } {
    // Check for explicit [CIERRE] marker
    if (content.includes('[CIERRE]')) {
      return { intent: 'cierre', data: undefined };
    }

    // Try to extract structured [DATOS EXTRAIDOS] block
    const blockMatch = content.match(
      /\[DATOS EXTRAIDOS\]([\s\S]*?)\[\/DATOS EXTRAIDOS\]/i
    );

    if (blockMatch) {
      const block = blockMatch[1];
      const data: FinancialData = {};

      const montoMatch = block.match(/monto:\s*([\d.,]+)/i);
      if (montoMatch) {
        const raw = parseFloat(montoMatch[1].replace(/\./g, '').replace(',', '.'));
        if (!isNaN(raw)) data.monto = raw;
      }

      const cuotasMatch = block.match(/cuotas:\s*(\d+)/i);
      if (cuotasMatch) {
        data.cuotas = parseInt(cuotasMatch[1], 10);
      }

      const fechaMatch = block.match(/fecha:\s*(\d{4}-\d{2}-\d{2})/i);
      if (fechaMatch) {
        data.fecha = fechaMatch[1];
      }

      const pctMatch = block.match(/porcentajeHonorarios:\s*([\d.]+)/i);
      if (pctMatch) {
        data.porcentajeHonorarios = parseFloat(pctMatch[1]);
      }

      return { intent: userIntent, data };
    }

    // No structured block — run general extraction on the whole response
    const data = extractFinancialData(content);
    return { intent: userIntent, data };
  }

  /**
   * Classify the assistant response into a response type.
   *
   * @param content - Raw text from Claude.
   * @returns One of: 'confirmation' | 'ask_for_clarification' | 'error' | 'summary'
   */
  private determineResponseType(
    content: string
  ): 'confirmation' | 'ask_for_clarification' | 'error' | 'summary' {
    const lower = content.toLowerCase();

    if (
      lower.includes('registrado') ||
      lower.includes('confirmado') ||
      lower.includes('✅')
    ) {
      return 'confirmation';
    }

    if (
      content.includes('?') ||
      lower.includes('podría') ||
      lower.includes('podrías') ||
      lower.includes('por favor')
    ) {
      return 'ask_for_clarification';
    }

    if (
      lower.includes('error') ||
      lower.includes('advertencia') ||
      lower.includes('inválido')
    ) {
      return 'error';
    }

    return 'summary';
  }

  /**
   * Extract warning flags from the assistant response.
   *
   * Looks for: "ADVERTENCIA: <text>", "NOTA: <text>", "[FLAG]" patterns.
   *
   * @param content - Raw text from Claude.
   * @returns Array of flag strings (may be empty).
   */
  private extractFlags(content: string): string[] {
    const flags: string[] = [];

    // ADVERTENCIA: <text up to newline>
    const advertenciaMatches = content.matchAll(/ADVERTENCIA:\s*(.+)/gi);
    for (const match of advertenciaMatches) {
      flags.push(`ADVERTENCIA: ${match[1].trim()}`);
    }

    // NOTA: <text up to newline>
    const notaMatches = content.matchAll(/NOTA:\s*(.+)/gi);
    for (const match of notaMatches) {
      flags.push(`NOTA: ${match[1].trim()}`);
    }

    // [FLAG] <text up to newline>
    const flagMatches = content.matchAll(/\[FLAG\]\s*(.+)/gi);
    for (const match of flagMatches) {
      flags.push(`FLAG: ${match[1].trim()}`);
    }

    return flags;
  }

  /**
   * Build the Sheets sync payload for the client to call the sync endpoint.
   *
   * @param intent - The detected intent (acuerdo | pago).
   * @param data   - Validated financial data.
   * @returns SheetsSyncData with action=UPDATE and relevant fields.
   */
  private buildSheetsSyncData(intent: Intent, data: FinancialData): SheetsSyncData {
    const fields: Record<string, unknown> = { intent };

    if (data.monto !== undefined) {
      fields.monto = data.monto;
    }
    if (data.cuotas !== undefined) {
      fields.cuotas = data.cuotas;
    }
    if (data.fecha !== undefined) {
      fields.fecha = data.fecha;
    }
    if (data.porcentajeHonorarios !== undefined) {
      fields.porcentajeHonorarios = data.porcentajeHonorarios;
    }

    return {
      action: 'UPDATE',
      fields,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export (ready to use)
// ─────────────────────────────────────────────────────────────────────────────

export const claudeAgent = ClaudeAgent.getInstance();

// Re-export AgentResponse so consumers don't need a separate import
export type { AgentResponse };
