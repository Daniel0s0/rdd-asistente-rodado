/**
 * agent.ts — RDD Agent Domain Types
 *
 * Zod schemas and inferred TypeScript types for the Claude Agent module.
 * Validates API request/response boundaries and financial data extracted
 * from conversation messages.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Intent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IntentSchema — detected purpose of a user message.
 * - acuerdo: settlement reached or proposed
 * - pago: payment received or referenced
 * - cierre: case closure requested
 * - consulta: general question about the case
 * - otro: none of the above
 */
export const IntentSchema = z.enum(['acuerdo', 'pago', 'cierre', 'consulta', 'otro']);
export type Intent = z.infer<typeof IntentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Financial Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FinancialExtractionSchema — optional financial data parsed from messages.
 * All fields are optional; validation rules enforce domain constraints when present.
 */
export const FinancialExtractionSchema = z.object({
  /** Settlement or payment amount in Chilean pesos (must be > 0 and <= 1,000,000,000) */
  monto: z.number().positive().max(1_000_000_000).optional(),

  /** Number of payment installments (positive integer, max 360) */
  cuotas: z.number().int().positive().max(360).optional(),

  /** Due date for the agreement or payment (ISO 8601 date string) */
  fecha: z.string().optional(),

  /** Lawyer fee percentage (0–100) */
  porcentajeHonorarios: z.number().min(0).max(100).optional(),
});
export type FinancialExtraction = z.infer<typeof FinancialExtractionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Sheets Sync Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SheetsSyncDataSchema — payload returned to the client when a Sheets update
 * is required. The client calls a separate Sheets endpoint with this data.
 */
export const SheetsSyncDataSchema = z.object({
  /** Operation type — always UPDATE for existing rows */
  action: z.literal('UPDATE'),

  /** Fields to merge into the current REGISTRO row */
  fields: z.record(z.unknown()),
});
export type SheetsSyncData = z.infer<typeof SheetsSyncDataSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Agent Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AgentResponseSchema — complete structured response from ClaudeAgent.chat().
 * Returned by the POST /agent/chat endpoint.
 */
export const AgentResponseSchema = z.object({
  /** UUID of the conversation thread */
  conversationId: z.string().uuid(),

  /** UUID of the assistant message saved to the database */
  messageId: z.string().uuid(),

  /** Claude's response text */
  assistantMessage: z.string(),

  /** Detected intent from the user message */
  intent: IntentSchema,

  /** Financial data extracted from the conversation (if any) */
  extractedData: FinancialExtractionSchema.optional(),

  /** Warning flags extracted from the assistant response */
  flags: z.array(z.string()),

  /** Whether the client should call the Sheets sync endpoint */
  shouldSyncSheets: z.boolean(),

  /** Sheets update payload — present only when shouldSyncSheets = true */
  sheetsSyncData: SheetsSyncDataSchema.optional(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// API Request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AgentChatRequestSchema — validates POST /agent/chat request body.
 */
export const AgentChatRequestSchema = z.object({
  /** Case identifier (e.g., "2024-00123") */
  causa_id: z.string().min(1, 'causa_id is required'),

  /** User message text */
  message: z.string().min(1, 'message is required'),
});
export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io Event Interfaces (Phase 5.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface SocketJoinCasePayload {
  causaId: string;
  apiKey: string;
}

export interface SocketSendMessagePayload {
  causaId: string;
  message: string;
}

export interface SocketLeaveCasePayload {
  causaId: string;
}

export interface SocketJoinedPayload {
  causaId: string;
}

export interface SocketMessageTokenPayload {
  token: string;
}

export interface SocketMessageCompletePayload {
  causaId: string;
  assistantMessage: string;
  intent: string;
  shouldSyncSheets: boolean;
  timestamp: string;
}

export interface SocketErrorPayload {
  code: 'auth_failed' | 'not_in_room' | 'validation_error' | 'stream_error' | 'internal_error';
  message: string;
}

export interface ServerToClientEvents {
  joined: (payload: SocketJoinedPayload) => void;
  message_token: (payload: SocketMessageTokenPayload) => void;
  message_complete: (payload: SocketMessageCompletePayload) => void;
  error: (payload: SocketErrorPayload) => void;
}

export interface ClientToServerEvents {
  join_case: (payload: SocketJoinCasePayload) => void;
  send_message: (payload: SocketSendMessagePayload) => void;
  leave_case: (payload: SocketLeaveCasePayload) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Agent Response (Phase 6.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PortfolioAgentResponse — lightweight response from portfolio chat.
 * No intent detection or financial extraction (read-only portfolio queries).
 */
export interface PortfolioAgentResponse {
  /** UUID of the portfolio conversation thread */
  conversationId: string;

  /** UUID of the assistant message saved to the database */
  messageId: string;

  /** Claude's response about the portfolio */
  assistantMessage: string;
}
