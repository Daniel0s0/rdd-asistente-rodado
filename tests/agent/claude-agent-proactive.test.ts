/**
 * claude-agent-proactive.test.ts — Phase 9.2: Proactive acuerdo detection
 *
 * Tests:
 *   - buildSystemPrompt injects ACCIÓN PENDIENTE when pending_action is set
 *   - buildSystemPrompt does not inject when pending_action is null
 *   - chat() clears pending_action flag after successful response
 *   - chat() does NOT clear flag when it is null (no extra DB call)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (before imports) ───────────────────────────────────────────────────

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'silent',
    SAAS_WEBHOOK_SECRET: 'test_secret',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_MODEL: 'claude-3-5-sonnet-20241022',
    CLAUDE_MAX_CONTEXT_TURNS: 10,
    CLAUDE_TEMPERATURE: 0.3,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'test-sheet-id',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'test-folder-id',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
    GOOGLE_API_TIMEOUT: 30000,
    GOOGLE_API_MAX_RETRIES: 3,
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_DETAILED_LOGGING: false,
  }),
}));

vi.mock('@database/supabase', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

vi.mock('@database/models', () => ({
  getConversationByCausaId: vi.fn(),
  getRecentMessages: vi.fn(),
  createMessage: vi.fn(),
  updateConversationMetadata: vi.fn(),
  closeConversation: vi.fn(),
  createSimpleConversation: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@database/analytics-queries', () => ({
  getCartKPI: vi.fn(),
  getIncomeData: vi.fn(),
  getAcuerdosStatus: vi.fn(),
  getCaseResults: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  (Anthropic as any).__mockCreate = mockCreate;
  return { Anthropic, APIError: class APIError extends Error {} };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { Anthropic } from '@anthropic-ai/sdk';
import {
  getConversationByCausaId,
  getRecentMessages,
  createMessage,
  updateConversationMetadata,
} from '@database/models';
import { ClaudeAgent } from '../../src/agent/claude-agent';
import { Conversation } from '@database/schema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-proactive-1',
    causa_id: 'causa-proactive-1',
    case_state: 'activa',
    pending_action: null,
    demandado: 'Empresa Test SA',
    tribunal: 'Juzgado N°1',
    rit: 'O-100-2026',
    etapa: 'litigacion',
    monto_demanda: 1_000_000,
    ingreso_honorarios: 0,
    pagos_pendientes: 0,
    message_count: 0,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    closed_at: null,
    ...overrides,
  };
}

function makeClaudeResponse(text = 'Respuesta de prueba') {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'claude-3-5-sonnet-20241022',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClaudeAgent — Phase 9.2: proactive acuerdo detection', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = (Anthropic as any).__mockCreate;
    mockCreate.mockResolvedValue(makeClaudeResponse());
    vi.mocked(getRecentMessages).mockResolvedValue([]);
    vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as any);
    vi.mocked(updateConversationMetadata).mockResolvedValue({} as any);
  });

  // ── buildSystemPrompt ──────────────────────────────────────────────────────

  it('buildSystemPrompt includes ACCIÓN PENDIENTE section when pending_action is set', () => {
    const agent = ClaudeAgent.getInstance() as any;
    const prompt: string = agent.buildSystemPrompt(
      makeConversation({ pending_action: 'ask_acuerdo_terms' })
    );

    expect(prompt).toContain('ACCIÓN PENDIENTE');
    expect(prompt).toContain('create_acuerdo');
    expect(prompt).toContain('Monto total del acuerdo');
  });

  it('buildSystemPrompt does NOT include ACCIÓN PENDIENTE when pending_action is null', () => {
    const agent = ClaudeAgent.getInstance() as any;
    const prompt: string = agent.buildSystemPrompt(
      makeConversation({ pending_action: null })
    );

    expect(prompt).not.toContain('ACCIÓN PENDIENTE');
  });

  // ── chat() flag cleanup ────────────────────────────────────────────────────

  it('chat() clears pending_action flag after successful response when flag is set', async () => {
    vi.mocked(getConversationByCausaId).mockResolvedValue(
      makeConversation({ pending_action: 'ask_acuerdo_terms' })
    );

    const agent = ClaudeAgent.getInstance();
    await agent.chat('causa-proactive-1', 'hola');

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'conv-proactive-1',
      { pending_action: null }
    );
  });

  it('chat() does NOT call updateConversationMetadata with pending_action: null when flag is already null', async () => {
    vi.mocked(getConversationByCausaId).mockResolvedValue(
      makeConversation({ pending_action: null })
    );

    const agent = ClaudeAgent.getInstance();
    await agent.chat('causa-proactive-1', 'hola');

    // If called at all, it must NOT be for clearing pending_action
    const clearCalls = vi.mocked(updateConversationMetadata).mock.calls.filter(
      ([, updates]) => updates && 'pending_action' in (updates as Record<string, unknown>)
    );
    expect(clearCalls).toHaveLength(0);
  });
});
