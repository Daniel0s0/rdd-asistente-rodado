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
} from '@database/models';
import { Conversation } from '@database/schema';
import { AgentResponse, SheetsSyncData, PortfolioAgentResponse } from '@domain/agent';
import {
  getCartKPI,
  getIncomeData,
  getAcuerdosStatus,
  getCaseResults,
  CartKPI,
  IncomeData,
  AcuerdoStatus,
  CaseResults,
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
// Helper: calculateCuotaDates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate monthly cuota payment dates.
 * Generates an array of ISO date strings (YYYY-MM-DD) starting from fechaPrimerPago,
 * advancing by one month for each cuota.
 *
 * @param fechaPrimerPago - First payment date (ISO string or Date-compatible)
 * @param cuotasTotal     - Total number of cuotas to generate dates for
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function calculateCuotaDates(
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
        tools: AGENT_TOOLS as Anthropic.Tool[],
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
    const currentMessages: Anthropic.MessageParam[] = [...claudeMessages]; // Copy for loop iterations (supports tool_use/tool_result content)
    let toolUseOccurred = false;
    const executedTools: string[] = []; // Track which tools were called

    let response = claudeResponse;
    for (;;) {
      // Check for tool use blocks
      const toolUseBlocks: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      for (const contentBlock of response.content) {
        if (contentBlock.type === 'tool_use') {
          toolUseBlocks.push({
            id: contentBlock.id,
            name: contentBlock.name,
            input: contentBlock.input as Record<string, unknown>,
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
      // Track executed tools for later intent detection
      executedTools.push(...toolUseBlocks.map((b) => b.name));

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
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = toolResults.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        // SDK 0.23 types don't admit string content here, but the API does — keep wire format unchanged
        content: result.content as unknown as Anthropic.ToolResultBlockParam['content'],
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
          tools: AGENT_TOOLS as Anthropic.Tool[],
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
    // Derive intent and financial data from tool execution or fallback parsing
    let parsedIntent: Intent = userIntent;
    let financialData: FinancialData | undefined;

    if (toolUseOccurred) {
      // Derive intent from executed tools
      if (executedTools.includes('create_acuerdo')) {
        parsedIntent = 'acuerdo';
      } else if (executedTools.includes('mark_cuota_pagada')) {
        parsedIntent = 'pago';
      } else if (executedTools.includes('create_registro')) {
        // create_registro is a financial action, but intent stays 'pago' or 'consulta'
        // based on context. For now, treat it like 'pago' (income-related)
        parsedIntent = 'pago';
      } else if (executedTools.includes('close_case')) {
        parsedIntent = 'cierre';
      }
      // If other tools executed (get_caso_estado, etc.) but no financial tool,
      // keep userIntent as-is
      logger.debug(
        { executedTools, derivedIntent: parsedIntent },
        'chat: intent derived from tool execution'
      );
    } else {
      // Fallback to old parsing for backwards compatibility (no tools executed)
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

    if (conversation.pending_action === 'ask_acuerdo_terms') {
      await updateConversationMetadata(conversation.id, { pending_action: null });
    }

    // ── 11. Update conversation state if agreement/payment ─────────────────
    // shouldSyncSheets = true when financial tools were executed (acuerdo, pago, registro)
    // or when parsed intent indicates financial action
    const shouldSyncSheets =
      parsedIntent === 'acuerdo' ||
      parsedIntent === 'pago' ||
      (toolUseOccurred && executedTools.some((t) =>
        ['create_acuerdo', 'mark_cuota_pagada', 'create_registro'].includes(t)
      ));

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

    let stream: ReturnType<typeof this.client.messages.stream>;

    try {
      stream = this.client.messages.stream({
        model: env.CLAUDE_MODEL,
        system: systemPrompt,
        messages: claudeMessages,
        max_tokens: 2048,
        temperature: env.CLAUDE_TEMPERATURE,
        tools: AGENT_TOOLS as Anthropic.Tool[],
      });

      // Stream first response tokens (before tool use)
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          onToken(event.delta.text);
        }
      }
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

    // ── 7.5 Handle tool use (non-streaming for MVP) ─────────────────────────
    let finalMessage = await stream.finalMessage();
    let assistantContent = '';
    const currentMessages: Anthropic.MessageParam[] = [...claudeMessages];
    let toolUseOccurred = false;
    const executedTools: string[] = []; // Track which tools were called

    // Tool use loop (same as chat())
    let response = finalMessage;
    for (;;) {
      const toolUseBlocks: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      for (const contentBlock of response.content) {
        if (contentBlock.type === 'tool_use') {
          toolUseBlocks.push({
            id: contentBlock.id,
            name: contentBlock.name,
            input: contentBlock.input as Record<string, unknown>,
          });
        } else if (contentBlock.type === 'text') {
          assistantContent = contentBlock.text;
        }
      }

      if (toolUseBlocks.length === 0) {
        break;
      }

      toolUseOccurred = true;
      // Track executed tools for later intent detection
      executedTools.push(...toolUseBlocks.map((b) => b.name));

      logger.debug(
        { conversationId: conversation.id, toolCount: toolUseBlocks.length },
        'chatStream: tool use detected, processing'
      );

      // Execute tools
      const toolResults = await processToolUseBlocks(
        toolUseBlocks,
        conversation.id
      );

      currentMessages.push({
        role: 'assistant',
        content: response.content,
      });

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = toolResults.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        // SDK 0.23 types don't admit string content here, but the API does — keep wire format unchanged
        content: result.content as unknown as Anthropic.ToolResultBlockParam['content'],
      }));

      currentMessages.push({
        role: 'user',
        content: toolResultBlocks,
      });

      // Continue non-streaming for tool results
      try {
        response = await this.client.messages.create({
          model: env.CLAUDE_MODEL,
          system: systemPrompt,
          messages: currentMessages,
          max_tokens: 2048,
          temperature: env.CLAUDE_TEMPERATURE,
          tools: AGENT_TOOLS as Anthropic.Tool[],
        });
      } catch (err) {
        const apiErr = err as AnthropicAPIError;
        const status = apiErr.status;
        logger.error(
          { conversationId: conversation.id, status, error: apiErr.message },
          'chatStream: Claude API error in tool loop'
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

    // Extract final text
    if (!assistantContent) {
      for (const contentBlock of response.content) {
        if (contentBlock.type === 'text') {
          assistantContent = contentBlock.text;
          break;
        }
      }
    }

    finalMessage = response;

    // ── 8. Parse assistant response ──────────────────────────────────────────
    // Derive intent and financial data from tool execution or fallback parsing
    let parsedIntent: Intent = userIntent;
    let financialData: FinancialData | undefined;

    if (toolUseOccurred) {
      // Derive intent from executed tools
      if (executedTools.includes('create_acuerdo')) {
        parsedIntent = 'acuerdo';
      } else if (executedTools.includes('mark_cuota_pagada')) {
        parsedIntent = 'pago';
      } else if (executedTools.includes('create_registro')) {
        // create_registro is a financial action, but intent stays 'pago' or 'consulta'
        // based on context. For now, treat it like 'pago' (income-related)
        parsedIntent = 'pago';
      } else if (executedTools.includes('close_case')) {
        parsedIntent = 'cierre';
      }
      // If other tools executed (get_caso_estado, etc.) but no financial tool,
      // keep userIntent as-is
      logger.debug(
        { executedTools, derivedIntent: parsedIntent },
        'chatStream: intent derived from tool execution'
      );
    } else {
      // Fallback to old parsing for backwards compatibility (no tools executed)
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

    if (conversation.pending_action === 'ask_acuerdo_terms') {
      await updateConversationMetadata(conversation.id, { pending_action: null });
    }

    // ── 11. Update conversation state if agreement/payment ─────────────────
    // shouldSyncSheets = true when financial tools were executed (acuerdo, pago, registro)
    // or when parsed intent indicates financial action
    const shouldSyncSheets =
      parsedIntent === 'acuerdo' ||
      parsedIntent === 'pago' ||
      (toolUseOccurred && executedTools.some((t) =>
        ['create_acuerdo', 'mark_cuota_pagada', 'create_registro'].includes(t)
      ));

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
   - Input: motivo_cierre (pago_total|desistimiento|caducada), notas (opcional)

ESTADOS DE LA CAUSA:
- activa: causa en tramitación (litigacion o cobranza)
- cerrada: causa terminada

ETAPA:
- litigacion: tramitación judicial
- cobranza: cobro forzado post-sentencia

CUANDO SE CIERRA UNA CAUSA (close_case tool):
- pago_total: se cobró todo el monto demandado
- desistimiento: el cliente retiró la demanda (desistimiento)
- caducada: la causa caducó por falta de tramitación

IMPORTANTE: Una causa con acuerdo de cuotas vigente sigue siendo "activa" hasta que se pague la última cuota.

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
- Si datos están inconsistentes, menciona la advertencia pero procede si es razonable${conversation.pending_action === 'ask_acuerdo_terms' ? `

⚠️ ACCIÓN PENDIENTE — ALTA PRIORIDAD:
El SaaS registró un Cierre por Acuerdo en esta causa. El usuario aún no ha registrado los términos del acuerdo en RDD.

INSTRUCCIÓN: Antes de procesar el mensaje del usuario, pregunta primero:
"Vi que llegaste a acuerdo en esta causa 🎉 — ¿me confirmas los términos para registrarlo? Necesito:
- Monto total del acuerdo
- Número de cuotas
- Fecha del primer pago (YYYY-MM-DD)"

Cuando el usuario responda con los datos, usa la herramienta create_acuerdo para registrarlos.
Luego continúa con cualquier cosa que el usuario haya escrito en su mensaje original.` : ''}`;
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
    cartKPI: CartKPI,
    incomeData: IncomeData,
    acuerdos: AcuerdoStatus[],
    resultados: CaseResults
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
      .map((m) => `${m.mes}: ${formatCurrency(m.total)} (cobranza ${formatCurrency(m.cobranza)} / sentencia ${formatCurrency(m.sentencia)} / acuerdo ${formatCurrency(m.acuerdo)})`)
      .join('\n');

    // Format active agreements
    const acuerdosFormatted = acuerdos
      .slice(0, 10) // Show first 10 to keep prompt reasonable
      .map((a) => `${a.causaId}: ${formatCurrency(a.montoTotal)} (${a.cuotasPagadas}/${a.cuotasTotal} cuotas, próx ${a.proximoVencimiento}, ${a.estadoGeneral})`)
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
