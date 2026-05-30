/**
 * models.test.ts — RDD Database CRUD Integration Tests (Supabase)
 *
 * Strategy:
 *   - Mock getDb() from @database/supabase
 *   - Verify that model functions call Supabase correctly
 *   - Use simple mock builders for PostgREST responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock env BEFORE importing models ───────────────────────────────────────────
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

// ─── Mock getDb (Supabase) BEFORE importing models ───────────────────────────
vi.mock('@database/supabase', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

// Now import models (they will use the mocked getDb).
import * as models from '@database/models';
import { getDb } from '@database/supabase';
import { Conversation, Message, AuditLogEntry } from '@database/schema';

// ─── Mock Query Builder ──────────────────────────────────────────────────────

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

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Database CRUD Operations', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      from: vi.fn().mockReturnValue(createMockPostgrestQuery()),
    };
    vi.mocked(getDb).mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Conversation CRUD ──────────────────────────────────────────────────────

  describe('Conversation CRUD', () => {
    it('creates conversation with webhook data', async () => {
      const causaId = '2024-00123';
      const webhookData = {
        cliente_nombre: 'García López',
        cliente_rut: '12.345.678-9',
        demandado: 'Acme Corp',
        tribunal: 'Laboral de Santiago',
        rit: '24-00123-4',
      };

      const mockResponse: Conversation = {
        id: 'conv-123',
        causa_id: causaId,
        cliente_nombre: webhookData.cliente_nombre,
        cliente_rut: webhookData.cliente_rut,
        demandado: webhookData.demandado,
        tribunal: webhookData.tribunal,
        rit: webhookData.rit,
        etapa: undefined,
        monto_demanda: undefined,
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


      const result = await models.createConversation(causaId, webhookData);

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
      expect(result.causa_id).toBe(causaId);
    });

    it('finds conversation by causa_id', async () => {
      const causaId = '2024-00789';
      const mockResponse: Conversation = {
        id: 'conv-456',
        causa_id: causaId,
        cliente_nombre: 'María López',
        cliente_rut: '98.765.432-1',
        demandado: 'Otro Corp',
        tribunal: 'Juzgado Civil',
        rit: '24-00789-1',
        etapa: 'litigacion',
        monto_demanda: 1000000,
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


      const result = await models.getConversationByCausaId(causaId);

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
      expect(result?.causa_id).toBe(causaId);
    });

    it('returns null for non-existent causa_id', async () => {
      mockQuery.then = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await models.getConversationByCausaId('nonexistent-causa');

      expect(result).toBeNull();
    });

    it('updates conversation metadata', async () => {
      const conversationId = 'conv-123';
      const updates = { acuerdo_monto: 1800000, acuerdo_cuotas: 5 };

      const mockResponse: Conversation = {
        id: conversationId,
        causa_id: '2024-00123',
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Corp',
        tribunal: 'Test Court',
        rit: '24-00123-1',
        etapa: 'litigacion',
        monto_demanda: 500000,
        case_state: 'activo',
        ingreso_honorarios: 0,
        pagos_pendientes: 0,
        acuerdo_monto: 1800000,
        acuerdo_cuotas: 5,
        abogado_nombre: undefined,
        abogado_email: undefined,
        drive_folder_id: undefined,
        message_count: 0,
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
        closed_at: null,
      };


      const result = await models.updateConversationMetadata(conversationId, updates);

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
      expect(result.acuerdo_monto).toBe(1800000);
    });

    it('closes conversation', async () => {
      const conversationId = 'conv-789';
      const mockResponse: Conversation = {
        id: conversationId,
        causa_id: '2024-00789',
        cliente_nombre: 'Test',
        cliente_rut: '12.345.678-9',
        demandado: 'Test Corp',
        tribunal: 'Test Court',
        rit: '24-00789-1',
        etapa: 'litigacion',
        monto_demanda: undefined,
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
        closed_at: new Date(),
      };


      const result = await models.closeConversation(conversationId, 'admin_user');

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
      expect(result.closed_at).not.toBeNull();
    });
  });

  // ─── Message CRUD ──────────────────────────────────────────────────────────

  describe('Message CRUD', () => {
    it('stores user message with metadata', async () => {
      const conversationId = 'conv-123';
      const messageText = 'Acuerdo de $500k en 5 cuotas';

      const mockResponse: Message = {
        id: 'msg-123',
        conversation_id: conversationId,
        role: 'user',
        content: messageText,
        metadata: { intent: 'agreement', monto: 500000, cuotas: 5 },
        created_at: new Date(),
      };


      const result = await models.createMessage(conversationId, 'user', messageText, {
        intent: 'agreement',
        monto: 500000,
        cuotas: 5,
      });

      expect(mockDb.from).toHaveBeenCalledWith('messages');
      expect(result.role).toBe('user');
    });

    it('stores assistant message with metadata', async () => {
      const conversationId = 'conv-123';
      const messageText = '✅ Registrado: Acuerdo de $500,000 en 5 cuotas';

      const mockResponse: Message = {
        id: 'msg-456',
        conversation_id: conversationId,
        role: 'assistant',
        content: messageText,
        metadata: { model: 'claude-3-5-sonnet-20241022', tokens_used: 250 },
        created_at: new Date(),
      };


      const result = await models.createMessage(conversationId, 'assistant', messageText, {
        model: 'claude-3-5-sonnet-20241022',
        tokens_used: 250,
      });

      expect(mockDb.from).toHaveBeenCalledWith('messages');
      expect(result.role).toBe('assistant');
    });

    it('returns recent messages', async () => {
      const conversationId = 'conv-123';
      const mockMessages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversationId,
          role: 'user',
          content: 'Hola',
          metadata: {},
          created_at: new Date('2026-05-30T10:00:00Z'),
        },
        {
          id: 'msg-2',
          conversation_id: conversationId,
          role: 'assistant',
          content: 'Hola!',
          metadata: {},
          created_at: new Date('2026-05-30T10:01:00Z'),
        },
      ];


      const result = await models.getRecentMessages(conversationId, 20);

      expect(mockDb.from).toHaveBeenCalledWith('messages');
      expect(result.length).toBe(2);
    });

    it('returns conversation history', async () => {
      const conversationId = 'conv-123';
      const mockMessages: Message[] = [
        {
          id: 'msg-1',
          conversation_id: conversationId,
          role: 'user',
          content: 'Mensaje 1',
          metadata: {},
          created_at: new Date(),
        },
      ];


      const result = await models.getConversationHistory(conversationId);

      expect(mockDb.from).toHaveBeenCalledWith('messages');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── List with Search & Filters ──────────────────────────────────────────────

  describe('List Conversations with Search & Filters', () => {
    it('lists conversations with search query', async () => {
      const mockConversations: Conversation[] = [
        {
          id: 'conv-1',
          causa_id: '2024-00001',
          cliente_nombre: 'García López',
          cliente_rut: '12.345.678-9',
          demandado: 'Acme',
          tribunal: 'Laboral',
          rit: '24-00001-1',
          etapa: 'litigacion',
          monto_demanda: 500000,
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
        },
      ];

      mockQuery.then = vi.fn().mockResolvedValue({ data: mockConversations, error: null });

      const result = await models.listConversations({ q: 'García', limit: 10, offset: 0 });

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
      expect(Array.isArray(result)).toBe(true);
    });

    it('lists conversations filtered by case_state', async () => {
      mockQuery.then = vi.fn().mockResolvedValue({ data: [], error: null });

      await models.listConversations({ case_state: 'desistido', limit: 10, offset: 0 });

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
    });

    it('lists conversations filtered by tribunal', async () => {
      mockQuery.then = vi.fn().mockResolvedValue({ data: [], error: null });

      await models.listConversations({ tribunal: 'Laboral de Santiago', limit: 10, offset: 0 });

      expect(mockDb.from).toHaveBeenCalledWith('conversations');
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────────────

  describe('Audit Log Operations', () => {
    it('creates audit log entry', async () => {
      const mockEntry: AuditLogEntry = {
        id: 'audit-123',
        entity_type: 'conversation',
        entity_id: 'conv-123',
        action: 'CREATE',
        user_id: 'admin_user',
        changes: { causa_id: { before: null, after: '2024-00123' } },
        metadata: {},
        created_at: new Date(),
      };

      mockQuery.then = vi.fn().mockResolvedValue({ data: mockEntry, error: null });

      const result = await models.createAuditLogEntry(
        'conversation',
        'conv-123',
        'CREATE',
        'admin_user',
        { causa_id: { before: null, after: '2024-00123' } }
      );

      expect(mockDb.from).toHaveBeenCalledWith('audit_log');
      expect(result.action).toBe('CREATE');
    });

    it('returns audit trail for entity', async () => {
      const mockEntries: AuditLogEntry[] = [
        {
          id: 'audit-1',
          entity_type: 'conversation',
          entity_id: 'conv-123',
          action: 'CREATE',
          user_id: 'admin',
          changes: {},
          metadata: {},
          created_at: new Date(),
        },
      ];

      mockQuery.then = vi.fn().mockResolvedValue({ data: mockEntries, error: null });

      const result = await models.getAuditTrail('conv-123');

      expect(mockDb.from).toHaveBeenCalledWith('audit_log');
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
