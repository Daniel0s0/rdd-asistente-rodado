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
  createSimpleConversation,
  createAcuerdo,
  createCuotas,
  createRegistro,
  markCuotaPagada,
  getAcuerdosActivos,
} from '@database/models';
import { Conversation } from '@database/schema';
import { AgentResponse, SheetsSyncData, PortfolioAgentResponse } from '@domain/agent';
import {
  getCartKPI,
  getIncomeData,
  getAcuerdosStatus,
  getCaseResults,
} from '@database/analytics-queries';
import {
  parseUserIntent,
  extractFinancialData,
  validateFinancialData,
  ValidationError as ParserValidationError,
  FinancialData,
  Intent,
} from './message-parser';
import { AGENT_TOOLS } from './tool-definitions';
import { processToolUseBlocks } from './tool-handlers';

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
        tools: AGENT_TOOLS as any, // Type: Anthropic SDK Tool[]
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

    // ── 7.5 Handle tool use loop ────────────────────────────────────────────
    let assistantContent = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentMessages: any[] = [...claudeMessages]; // Copy for loop iterations (typed broadly to support tool_use/tool_result content)
    let toolUseOccurred = false;

    let response = claudeResponse;
    while (true) {
      // Check for tool use blocks
      const toolUseBlocks: Array<{
        id: string;
        name: string;
        input: Record<string, any>;
      }> = [];

      for (const contentBlock of response.content) {
        if (contentBlock.type === 'tool_use') {
          toolUseBlocks.push({
            id: contentBlock.id,
            name: contentBlock.name,
            input: contentBlock.input as Record<string, any>,
          });
        } else if (contentBlock.type === 'text') {
          assistantContent = contentBlock.text;
        }
      }

      // If no tool use, we're done
      if (toolUseBlocks.length === 0) {
        break;
      }

      toolUseOccurred = true;
      logger.debug(
        { conversationId: conversation.id, toolCount: toolUseBlocks.length },
        'chat: tool use detected, processing'
      );

      // Execute tools
      const toolResults = await processToolUseBlocks(
        toolUseBlocks,
        conversation.id
      );

      // Add assistant response + tool results to message history
      currentMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Build tool result blocks
      const toolResultBlocks = toolResults.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        content: result.content,
      }));

      currentMessages.push({
        role: 'user',
        content: toolResultBlocks,
      });

      // Call Claude again with tool results
      try {
        response = await this.client.messages.create({
          model: env.CLAUDE_MODEL,
          system: systemPrompt,
          messages: currentMessages,
          max_tokens: 2048,
          temperature: env.CLAUDE_TEMPERATURE,
          tools: AGENT_TOOLS as any,
        });
      } catch (err) {
        const apiErr = err as AnthropicAPIError;
        const status = apiErr.status;
        logger.error(
          { conversationId: conversation.id, status, error: apiErr.message },
          'chat: Claude API error in tool loop'
        );

        if (status === 429 || (status !== undefined && status >= 500)) {
          throw new TemporaryError(
            `Claude API temporary error (status ${status}): ${apiErr.message}`
          );
        }
        if (status === 401 || status === 403) {
          throw new ClaudeAPIError(
            `Claude API auth error (status ${status}): ${apiErr.message}`
          );
        }
        throw err;
      }
    }

    // Extract final text response
    if (!assistantContent) {
      for (const contentBlock of response.content) {
        if (contentBlock.type === 'text') {
          assistantContent = contentBlock.text;
          break;
        }
      }
    }

    // ── 8. Parse assistant response ──────────────────────────────────────────
    // If tools were executed, skip old-style parsing
    let parsedIntent: Intent = userIntent;
    let financialData: FinancialData | undefined;

    if (!toolUseOccurred) {
      // Fallback to old parsing for backwards compatibility
      const parsed = this.parseAssistantResponse(assistantContent, userIntent);
      parsedIntent = parsed.intent;
      financialData = parsed.data;
    }

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

    // ── 10. Save assistant message (atomic + audit) ───────────────────────────
    const tokensUsed = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };

    const assistantDbMessage = await createMessage(
      conversation.id,
      'assistant',
      assistantContent,
      {
        response_type: responseType,
        processing_ok: true,
        flags,
        model: response.model,
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
   * Portfolio-wide conversation (Phase 6.5).
   * Answers questions about the entire portfolio without requiring a specific causa_id.
   *
   * @param userMessage    - User question about the portfolio
   * @param conversationId - Optional existing conversation ID for multi-turn (reuses `__portfolio__` row)
   * @returns PortfolioAgentResponse with assistantMessage
   */
  async portfolioChat(
    userMessage: string,
    conversationId?: string
  ): Promise<PortfolioAgentResponse> {
    const env = getEnv();

    // ── 1. Validate input ────────────────────────────────────────────────────
    if (!userMessage || userMessage.trim() === '') {
      throw new ValidationError('userMessage is required and must not be empty');
    }

    logger.info({ conversationId: conversationId || 'new' }, 'ClaudeAgent.portfolioChat: starting');

    // ── 2. Get or create `__portfolio__` conversation ────────────────────────
    let conversation = await getConversationByCausaId('__portfolio__');

    if (!conversation) {
      logger.info({}, 'ClaudeAgent.portfolioChat: creating portfolio conversation');
      try {
        conversation = await createSimpleConversation('__portfolio__');
      } catch (error) {
        logger.error({ error }, 'ClaudeAgent.portfolioChat: failed to create conversation');
        throw new ValidationError('Failed to create portfolio conversation');
      }
    }

    // Override with explicit conversationId if provided (multi-turn reuse)
    if (conversationId && conversationId !== conversation.id) {
      try {
        const explicit = await getConversationByCausaId('__portfolio__');
        if (explicit && explicit.id === conversationId) {
          conversation = explicit;
        }
      } catch {
        // Ignore error, use existing conversation
      }
    }

    // ── 3. Load message history ──────────────────────────────────────────────
    const recentMessages = await getRecentMessages(
      conversation.id,
      env.CLAUDE_MAX_CONTEXT_TURNS
    );

    logger.debug(
      { conversationId: conversation.id, historyCount: recentMessages.length },
      'ClaudeAgent.portfolioChat: history loaded'
    );

    // ── 4. Save user message ─────────────────────────────────────────────────
    const userDbMessage = await createMessage(
      conversation.id,
      'user',
      userMessage,
      { intent: 'consulta' } // Portfolio queries are always 'consulta' (read-only)
    );

    // ── 5. Build messages array for Claude ───────────────────────────────────
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
      recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    claudeMessages.push({ role: 'user', content: userMessage });

    // ── 6. Fetch analytics context in parallel ───────────────────────────────
    const [cartKPI, incomeData, acuerdos, resultados] = await Promise.all([
      getCartKPI(),
      getIncomeData(
        new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0], // Jan 1st this year
        new Date().toISOString().split('T')[0] // today
      ),
      getAcuerdosStatus(),
      getCaseResults(),
    ]);

    // ── 7. Build portfolio system prompt with analytics data ──────────────────
    const portfolioSystemPrompt = this.buildPortfolioSystemPrompt(
      cartKPI,
      incomeData,
      acuerdos,
      resultados
    );

    // ── 8. Call Claude SDK ───────────────────────────────────────────────────
    let claudeResponse: Awaited<ReturnType<typeof this.client.messages.create>>;
    try {
      claudeResponse = await this.client.messages.create({
        model: env.CLAUDE_MODEL,
        system: portfolioSystemPrompt,
        messages: claudeMessages,
        max_tokens: 2048,
        temperature: env.CLAUDE_TEMPERATURE,
      });
    } catch (err) {
      const apiErr = err as AnthropicAPIError;
      const status = apiErr.status;
      logger.error(
        { conversationId: conversation.id, status, error: apiErr.message },
        'ClaudeAgent.portfolioChat: Claude API error'
      );

      if (status === 429 || (status !== undefined && status >= 500)) {
        throw new TemporaryError(
          `Claude API temporary error (status ${status}): ${apiErr.message}`
        );
      }
      if (status === 401 || status === 403) {
        throw new ClaudeAPIError(
          `Claude API auth error (status ${status}): ${apiErr.message}`
        );
      }
      if (status === 400) {
        throw new ValidationError(
          `Claude API bad request (status 400): ${apiErr.message}`
        );
      }
      throw err;
    }

    // Extract text
    const contentBlock = claudeResponse.content[0];
    const assistantContent =
      contentBlock && contentBlock.type === 'text' ? contentBlock.text : '';

    // ── 9. Save assistant message ────────────────────────────────────────────
    const assistantDbMessage = await createMessage(
      conversation.id,
      'assistant',
      assistantContent,
      {
        response_type: 'summary',
        processing_ok: true,
        model: claudeResponse.model,
        tokens_used: {
          input: claudeResponse.usage.input_tokens,
          output: claudeResponse.usage.output_tokens,
        },
      }
    );

    logger.info(
      {
        conversationId: conversation.id,
        userMessageId: userDbMessage.id,
        assistantMessageId: assistantDbMessage.id,
      },
      'ClaudeAgent.portfolioChat: complete'
    );

    // ── Return PortfolioAgentResponse ────────────────────────────────────────
    return {
      conversationId: conversation.id,
      messageId: assistantDbMessage.id,
      assistantMessage: assistantContent,
    };
  }

  /**
   * Build the system prompt for Claude using case information.
   * Declares the 5 tools explicitly to Claude with descriptions and when to use them.
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

HERRAMIENTAS DISPONIBLES:
Tienes acceso a estas herramientas para ejecutar acciones financieras directamente:

1. **create_registro** — Registra ingresos o gastos (cobranza, sentencia, gasto)
   - Úsalo cuando: dinero llega sin estructura de cuotas
   - Input: tipo (cobranza|sentencia|gasto), monto, fecha, descripción (opcional)

2. **create_acuerdo** — Registra acuerdo pactado con cuotas
   - Úsalo cuando: usuario menciona acuerdo/arreglo con múltiples pagos
   - Input: montoTotal, cuotasTotal, fechaPrimerPago, porcentajeHonorarios (opcional)
   - Nota: El sistema genera automáticamente las fechas de cada cuota (mensualmente)

3. **mark_cuota_pagada** — Marca una cuota como pagada
   - Úsalo cuando: usuario confirma que pagó una de las cuotas
   - Input: acuerdoId, numeroCuota, fecha

4. **get_caso_estado** — Consulta estado actual del caso
   - Úsalo cuando: usuario pregunta "¿Cómo vamos?" o necesitas contexto
   - Input: incluirHistorial (opcional)

5. **close_case** — Cierra la causa
   - Úsalo cuando: usuario confirma que la causa está completamente resuelta
   - Input: razonCierre (pagado_completo|acuerdo|desestimado|otro), notas (opcional)

INSTRUCCIONES:
- Cuando el usuario mencione dinero/pagos/acuerdos, INTERPRETA SU INTENCIÓN y usa la herramienta correspondiente
- No pidas confirmación antes de usar herramientas si los datos son claros
- Siempre confirma lo que hiciste: "✅ Registrado: [detalles]"
- Si falta información crítica, pregunta antes de usar herramientas
- Valida que los datos tengan sentido (monto > 0, fechas futuras o hoy, %)

RESTRICCIONES:
- Solo acepta montos > 0
- Porcentajes entre 0–100%
- Fechas deben ser hoy o anterior
- Si datos están inconsistentes, menciona la advertencia pero procede si es razonable`;
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

  /**
   * Build portfolio system prompt (Phase 6.5).
   * Formats analytics data as readable context for portfolio-wide queries.
   */
  private buildPortfolioSystemPrompt(
    cartKPI: any,
    incomeData: any,
    acuerdos: any[],
    resultados: any
  ): string {
    const formatCurrency = (num: number) => {
      if (num >= 1_000_000) {
        return `$${(num / 1_000_000).toFixed(1)}M`;
      }
      if (num >= 1_000) {
        return `$${(num / 1_000).toFixed(0)}K`;
      }
      return `$${num}`;
    };

    // Format last 6 months of income
    const lastSixMonths = incomeData.porMes
      .slice(-6)
      .map((m: any) => `${m.mes}: ${formatCurrency(m.total)} (cobranza ${formatCurrency(m.cobranza)} / sentencia ${formatCurrency(m.sentencia)} / acuerdo ${formatCurrency(m.acuerdo)})`)
      .join('\n');

    // Format active agreements
    const acuerdosFormatted = acuerdos
      .slice(0, 10) // Show first 10 to keep prompt reasonable
      .map((a: any) => `${a.causaId}: ${formatCurrency(a.montoTotal)} (${a.cuotasPagadas}/${a.cuotasTotal} cuotas, próx ${a.proximoVencimiento}, ${a.estadoGeneral})`)
      .join('\n');

    return `Eres Rodado, asistente del estudio jurídico RDD. Respondes preguntas sobre la cartera completa del bufete.

DATOS DE LA CARTERA (actualizados al momento de esta consulta):

KPIs GENERALES:
- Cobrado este año: ${formatCurrency(cartKPI.totalCobradoAnio)}
- Cobrado este mes: ${formatCurrency(cartKPI.cobradoEsteMes)}
- Acuerdos activos: ${cartKPI.acuerdosActivos}
- Cuotas vencidas: ${cartKPI.cuotasVencidas}
- % causas con resultado: ${cartKPI.porcentajeResultados}%
- Causas activas: ${cartKPI.causasActivas}
- Causas desistidas: ${cartKPI.causasDesistidas}
- Causas caducadas: ${cartKPI.causasCaducadas}

INGRESOS ÚLTIMOS 6 MESES:
${lastSixMonths}

DISTRIBUCIÓN POR FUENTE:
- Cobranza: ${incomeData.porFuente.cobranza}%
- Sentencia: ${incomeData.porFuente.sentencia}%
- Acuerdo: ${incomeData.porFuente.acuerdo}%

ACUERDOS ACTIVOS (primeros 10):
${acuerdosFormatted}

ESTADÍSTICAS DE CAUSAS:
- Total: ${resultados.total}
- Con resultado: ${resultados.conResultado}
- Sin resultado: ${resultados.sinResultado}
- Desistidas: ${resultados.desistidas}
- Caducadas: ${resultados.caducadas}

INSTRUCCIONES:
- Tienes acceso completo y directo a la base de datos real del estudio jurídico
- Los datos mostrados arriba SON los datos reales del sistema (no hay otro sistema al que acceder)
- Si los valores muestran $0 o secciones vacías, significa que aún no hay registros cargados — no que carezcas de acceso
- Cuando el usuario pregunte por recupero o ingresos, muestra los KPIs directamente desde los datos de arriba
- Responde en español con tono profesional y conciso
- Usa pesos chilenos con formato legible ($1.5M, $800K)
- Si el usuario pregunta sobre una causa específica, sugiere que use la vista de "Causas"
- Sé honesto sobre los datos: si muestran cero, comunica eso claramente (ej: "no hay registros aún")`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export (ready to use)
// ─────────────────────────────────────────────────────────────────────────────

export const claudeAgent = ClaudeAgent.getInstance();

// Re-export AgentResponse so consumers don't need a separate import
export type { AgentResponse };
