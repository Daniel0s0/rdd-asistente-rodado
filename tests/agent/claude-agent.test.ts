/**
 * claude-agent.test.ts — Unit/Integration tests for src/agent/claude-agent.ts
 *
 * Strategy:
 *   - Use :memory: SQLite (mocked via @database/sqlite) for isolation.
 *   - Mock Anthropic SDK to control Claude API responses.
 *   - Test the ClaudeAgent.chat() orchestration: history loading, intent
 *     detection, DB persistence, error propagation, Sheets sync flag.
 *
 * Covered cases:
 *   Happy path:
 *     - Valid chat: causaId exists → loads history → calls Claude → saves messages → AgentResponse
 *     - Intent 'acuerdo' → shouldSyncSheets = true
 *     - Intent 'consulta' → shouldSyncSheets = false
 *   Error cases:
 *     - causaId not found → ValidationError
 *     - Empty message → ValidationError
 *     - Claude API 429 → TemporaryError
 *     - Claude API 500 → TemporaryError
 *     - Claude API 401 → ClaudeAPIError
 *     - Invalid financial data from Claude → ValidationError
 *   Persistence:
 *     - User message saved to DB with intent metadata
 *     - Assistant message saved to DB with tokens metadata
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock @config/env BEFORE anything else ───────────────────────────────────
vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'info',
    SAAS_WEBHOOK_SECRET: 'test_secret',
    SAAS_API_URL: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_MODEL: 'claude-3-5-sonnet-20241022',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'test-sheet-id',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'test-folder-id',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    CLAUDE_MAX_CONTEXT_TURNS: 10,
    CLAUDE_TEMPERATURE: 0.3,
    GOOGLE_API_TIMEOUT: 30000,
    GOOGLE_API_MAX_RETRIES: 3,
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_DETAILED_LOGGING: false,
  }),
}));

// ─── Mock @database/supabase BEFORE anything else ────────────────────────────
vi.mock('@database/supabase', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

// ─── Mock Anthropic SDK ───────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // Expose mockCreate on the constructor so tests can reach it
  (Anthropic as any).__mockCreate = mockCreate;
  return { Anthropic };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { getDb } from '@database/supabase';
import { Anthropic } from '@anthropic-ai/sdk';
import { createConversation, getConversationHistory } from '@database/models';
import { ValidationError, ClaudeAPIError, TemporaryError } from '@agent/claude-agent';
import { Conversation } from '@database/schema';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a mock Supabase PostgREST query chain with proper async support. */
function createMockPostgrestQuery(returnData: any = null) {
  // Create a self-referential query chain that returns promises
  const createChain = (data: any) => ({
    select: vi.fn().mockImplementation(() => createChain(data)),
    eq: vi.fn().mockImplementation(() => createChain(data)),
    is: vi.fn().mockImplementation(() => createChain(data)),
    or: vi.fn().mockImplementation(() => createChain(data)),
    gte: vi.fn().mockImplementation(() => createChain(data)),
    lte: vi.fn().mockImplementation(() => createChain(data)),
    in: vi.fn().mockImplementation(() => createChain(data)),
    insert: vi.fn().mockImplementation(() => createChain(data)),
    update: vi.fn().mockImplementation(() => createChain(data)),
    range: vi.fn().mockImplementation(() => createChain(data)),
    order: vi.fn().mockImplementation(() => createChain(data)),
    limit: vi.fn().mockImplementation(() => createChain(data)),
    single: vi.fn().mockImplementation(() => createChain(data)),
    then: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve({ data, error: null }).then(onFulfilled, onRejected),
    catch: (onRejected: any) =>
      Promise.resolve({ data, error: null }).catch(onRejected),
  });

  return createChain(returnData);
}

/** Retrieve the vi.fn() used as messages.create. */
function getMockCreate(): ReturnType<typeof vi.fn> {
  return (Anthropic as any).__mockCreate as ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal Claude SDK response that passes through
 * parseAssistantResponse() as-is (no [DATOS EXTRAIDOS] block).
 */
function buildClaudeResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-3-5-sonnet-20241022',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/**
 * Build a Claude response that includes a structured [DATOS EXTRAIDOS] block
 * so the agent extracts financial data correctly.
 */
function buildClaudeResponseWithData(
  text: string,
  data: { monto?: number; cuotas?: number; fecha?: string; porcentajeHonorarios?: number }
) {
  const lines = ['[DATOS EXTRAIDOS]'];
  if (data.monto !== undefined) lines.push(`- monto: ${data.monto}`);
  if (data.cuotas !== undefined) lines.push(`- cuotas: ${data.cuotas}`);
  if (data.fecha !== undefined) lines.push(`- fecha: ${data.fecha}`);
  if (data.porcentajeHonorarios !== undefined)
    lines.push(`- porcentajeHonorarios: ${data.porcentajeHonorarios}`);
  lines.push('[/DATOS EXTRAIDOS]');
  const fullText = `${text}\n${lines.join('\n')}`;
  return buildClaudeResponse(fullText);
}

// ─── ClaudeAgent singleton reset ─────────────────────────────────────────────
// The ClaudeAgent is a singleton. We need to reset it between test groups
// that use different DB instances. We do this by re-importing (Vitest isolates
// modules per describe block when needed) or by resetting the mock return value.
// Since Vitest reuses the module, we reset the DB mock in beforeEach instead.

async function getAgentFresh() {
  // Import lazily to ensure mocks are in place
  const { claudeAgent } = await import('@agent/claude-agent');
  return claudeAgent;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('ClaudeAgent.chat()', () => {
  let mockDb: any;
  let mockQuery: any;
  let testCausaId: string;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Setup test causa ID first
    testCausaId = `TEST-${Date.now()}`;

    // Create base mock conversation for this test
    const mockConversation: Conversation = {
      id: 'conv-test',
      causa_id: testCausaId,
      cliente_nombre: 'Test Client',
      cliente_rut: '12.345.678-9',
      demandado: 'Juan Rodríguez',
      tribunal: 'Juzgado Civil de Santiago',
      rit: '123-2024',
      etapa: 'litigacion',
      monto_demanda: 5000000,
      case_state: 'activo',
      ingreso_honorarios: 0,
      pagos_pendientes: 0,
      acuerdo_monto: undefined,
      acuerdo_cuotas: undefined,
      abogado_nombre: undefined,
      abogado_email: undefined,
      drive_folder_id: undefined,
      message_count: 0,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
      closed_at: null,
    };

    // Mock Supabase DB with dynamic responses based on table
    mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return createMockPostgrestQuery(mockConversation);
        } else if (table === 'messages') {
          return createMockPostgrestQuery([]);
        } else if (table === 'audit_log') {
          return createMockPostgrestQuery([]);
        }
        // Default
        return createMockPostgrestQuery(null);
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb);

    // Reset the Anthropic mock
    mockCreate = getMockCreate();
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('retorna AgentResponse completo cuando request es válido', async () => {
    mockCreate.mockResolvedValue(buildClaudeResponse('Entendido. ¿Tienes más detalles?'));
    const agent = await getAgentFresh();

    const response = await agent.chat(testCausaId, 'Hola, consulta sobre la causa');

    expect(response.conversationId).toBeDefined();
    expect(response.messageId).toBeDefined();
    expect(response.assistantMessage).toBe('Entendido. ¿Tienes más detalles?');
    expect(response.intent).toBeDefined();
    expect(Array.isArray(response.flags)).toBe(true);
    expect(typeof response.shouldSyncSheets).toBe('boolean');
  });

  it('detects intent "acuerdo" → shouldSyncSheets = true', async () => {
    mockCreate.mockResolvedValue(
      buildClaudeResponseWithData('Acuerdo registrado ✅ confirmado', {
        monto: 1800000,
        cuotas: 12,
      })
    );
    const agent = await getAgentFresh();

    const response = await agent.chat(testCausaId, 'Hay acuerdo por $1,800,000 en 12 cuotas');

    expect(response.intent).toBe('acuerdo');
    expect(response.shouldSyncSheets).toBe(true);
    expect(response.sheetsSyncData).toBeDefined();
    expect(response.sheetsSyncData?.action).toBe('UPDATE');
  });

  it('detects intent "consulta" → shouldSyncSheets = false', async () => {
    mockCreate.mockResolvedValue(buildClaudeResponse('La causa está en etapa de negociación.'));
    const agent = await getAgentFresh();

    const response = await agent.chat(testCausaId, '¿Cuánto tiempo queda para el vencimiento?');

    expect(response.intent).toBe('consulta');
    expect(response.shouldSyncSheets).toBe(false);
    expect(response.sheetsSyncData).toBeUndefined();
  });

  it('detects intent "cierre" cuando respuesta incluye [CIERRE]', async () => {
    mockCreate.mockResolvedValue(buildClaudeResponse('Causa cerrada.\n[CIERRE]'));
    const agent = await getAgentFresh();

    const response = await agent.chat(testCausaId, 'Caso cerrado y archivado definitivamente');

    expect(response.intent).toBe('cierre');
    expect(response.shouldSyncSheets).toBe(false);
  });

  // ── Error cases ────────────────────────────────────────────────────────────

  it('lanza ValidationError cuando causaId no existe en la BD', async () => {
    const agent = await getAgentFresh();

    await expect(
      agent.chat('NONEXISTENT-99999', 'Mensaje de prueba')
    ).rejects.toThrow(ValidationError);

    await expect(
      agent.chat('NONEXISTENT-99999', 'Mensaje de prueba')
    ).rejects.toThrow('NONEXISTENT-99999');
  });

  it('lanza ValidationError cuando el mensaje está vacío', async () => {
    const agent = await getAgentFresh();

    await expect(agent.chat(testCausaId, '')).rejects.toThrow(ValidationError);
    await expect(agent.chat(testCausaId, '   ')).rejects.toThrow(ValidationError);
  });

  it('lanza ValidationError cuando causaId está vacío', async () => {
    const agent = await getAgentFresh();

    await expect(agent.chat('', 'Mensaje válido')).rejects.toThrow(ValidationError);
  });

  it('lanza TemporaryError cuando Claude API responde con 429 (rate limit)', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    mockCreate.mockRejectedValue(rateLimitError);
    const agent = await getAgentFresh();

    await expect(agent.chat(testCausaId, 'Consulta de estado')).rejects.toThrow(TemporaryError);
  });

  it('lanza TemporaryError cuando Claude API responde con 500 (server error)', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 });
    mockCreate.mockRejectedValue(serverError);
    const agent = await getAgentFresh();

    await expect(agent.chat(testCausaId, 'Consulta de estado')).rejects.toThrow(TemporaryError);
  });

  it('lanza ClaudeAPIError cuando Claude API responde con 401 (auth error)', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockCreate.mockRejectedValue(authError);
    const agent = await getAgentFresh();

    await expect(agent.chat(testCausaId, 'Consulta de estado')).rejects.toThrow(ClaudeAPIError);
  });

  it('lanza ValidationError cuando los datos financieros incluyen porcentaje inválido', async () => {
    // The [DATOS EXTRAIDOS] block uses regex /monto:\s*([\d.,]+)/ which doesn't capture '-'
    // so negative monto won't be parsed. Use porcentajeHonorarios > 100 instead,
    // which the regex WILL capture and validateFinancialData WILL reject.
    const invalidDataResponse = buildClaudeResponse(
      'Procesando...\n[DATOS EXTRAIDOS]\n- monto: 1000000\n- porcentajeHonorarios: 150\n[/DATOS EXTRAIDOS]'
    );
    mockCreate.mockResolvedValue(invalidDataResponse);
    const agent = await getAgentFresh();

    await expect(
      agent.chat(testCausaId, 'Acuerdo por $1,000,000')
    ).rejects.toThrow(ValidationError);
  });

  // ── Persistence ────────────────────────────────────────────────────────────

  it('guarda el mensaje del usuario en la BD con metadata de intent', async () => {
    mockCreate.mockResolvedValue(buildClaudeResponse('Respuesta del asistente.'));
    const agent = await getAgentFresh();

    await agent.chat(testCausaId, 'Hay acuerdo por $1,800,000 en 12 cuotas');

    // Verify via DB: fetch conversation and check messages
    const { getConversationByCausaId } = await import('@database/models');
    const conversation = await getConversationByCausaId(testCausaId);
    expect(conversation).not.toBeNull();

    const history = await getConversationHistory(conversation!.id);
    const userMessages = history.filter((m) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(1);

    const lastUser = userMessages[userMessages.length - 1];
    expect(lastUser.content).toBe('Hay acuerdo por $1,800,000 en 12 cuotas');
    // Metadata should include the detected intent
    expect(lastUser.metadata).toHaveProperty('intent');
  });

  it('guarda el mensaje del asistente en la BD con metadata de tokens', async () => {
    mockCreate.mockResolvedValue(
      buildClaudeResponse('Acuerdo registrado correctamente ✅', 15, 30)
    );
    const agent = await getAgentFresh();

    await agent.chat(testCausaId, 'Consulta simple');

    const { getConversationByCausaId } = await import('@database/models');
    const conversation = await getConversationByCausaId(testCausaId);
    expect(conversation).not.toBeNull();

    const history = await getConversationHistory(conversation!.id);
    const assistantMessages = history.filter((m) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant.content).toBe('Acuerdo registrado correctamente ✅');
    // Metadata should include tokens_used
    expect(lastAssistant.metadata).toHaveProperty('tokens_used');
    expect((lastAssistant.metadata as any).tokens_used).toEqual({ input: 15, output: 30 });
  });

  it('carga el historial previo antes de llamar a Claude', async () => {
    // First message
    mockCreate.mockResolvedValueOnce(buildClaudeResponse('Primera respuesta.'));
    const agent = await getAgentFresh();
    await agent.chat(testCausaId, 'Primer mensaje');

    // Second message — history should now contain the first turn
    mockCreate.mockResolvedValueOnce(buildClaudeResponse('Segunda respuesta.'));
    await agent.chat(testCausaId, 'Segundo mensaje');

    // Claude should have been called twice
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // The second call should include the first turn in the messages array
    const secondCallArgs = mockCreate.mock.calls[1][0];
    const messages: Array<{ role: string; content: string }> = secondCallArgs.messages;

    // Should have at least 3 entries: previous user, previous assistant, new user
    expect(messages.length).toBeGreaterThanOrEqual(3);
    const roles = messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('extrae flags ADVERTENCIA y NOTA de la respuesta del asistente', async () => {
    const responseWithFlags =
      'Acuerdo recibido.\nADVERTENCIA: El monto parece bajo.\nNOTA: Revisar vencimiento.';
    mockCreate.mockResolvedValue(buildClaudeResponse(responseWithFlags));
    const agent = await getAgentFresh();

    const response = await agent.chat(testCausaId, 'Acuerdo por $1,800,000');

    expect(response.flags).toContain('ADVERTENCIA: El monto parece bajo.');
    expect(response.flags).toContain('NOTA: Revisar vencimiento.');
  });
});
