import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'silent',
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

vi.mock('@database/models', () => ({
  listConversations: vi.fn(),
}));

import { casesHandler } from '@api/cases';
import * as models from '@database/models';

const mockListConversations = vi.mocked(models.listConversations);

describe('GET /cases handler', () => {
  function createRequest(query?: Record<string, string>): Partial<Request> {
    return { query: query ?? {} };
  }

  function createResponse(): Partial<Response> {
    return {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with list of conversations', async () => {
    const mockConversations = [
      {
        id: 'conv-1',
        causa_id: '2024-00001',
        cliente_nombre: 'García López',
        demandado: 'John Doe',
        tribunal: 'Laboral de Santiago',
        rit: '24-00001-1',
        etapa: 'litigacion',
        case_state: 'activa',
        ingreso_honorarios: 100000,
        pagos_pendientes: 50000,
        created_at: new Date('2026-05-01'),
        closed_at: null,
        metadata: {},
      },
      {
        id: 'conv-2',
        causa_id: '2024-00002',
        cliente_nombre: 'Smith Corp',
        demandado: 'Jane Smith',
        tribunal: 'Juzgado Civil',
        rit: '24-00002-1',
        etapa: 'cobranza',
        case_state: 'activa',
        ingreso_honorarios: 200000,
        pagos_pendientes: 100000,
        created_at: new Date('2026-05-02'),
        closed_at: null,
        metadata: {},
      },
    ];

    mockListConversations.mockResolvedValue(mockConversations);

    const req = createRequest() as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          cases: expect.arrayContaining([
            expect.objectContaining({
              causaId: '2024-00001',
              status: 'active',
              createdAt: '2026-05-01T00:00:00.000Z',
              clienteNombre: 'García López',
              demandado: 'John Doe',
              tribunal: 'Laboral de Santiago',
            }),
          ]),
          total: 2,
        }),
      })
    );
  });

  it('returns 200 with empty array when no cases exist', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest() as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          cases: [],
          total: 0,
        }),
      })
    );
  });

  it('marks closed cases with status=closed', async () => {
    const mockConversations = [
      {
        id: 'conv-1',
        causa_id: '2024-00001',
        cliente_nombre: 'Test',
        demandado: 'Test Corp',
        tribunal: 'Test Court',
        rit: '24-00001-1',
        etapa: 'litigacion',
        case_state: 'activa',
        ingreso_honorarios: 0,
        pagos_pendientes: 0,
        created_at: new Date('2026-05-01'),
        closed_at: new Date('2026-05-15'),
        metadata: {},
      },
    ];

    mockListConversations.mockResolvedValue(mockConversations);

    const req = createRequest() as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    const callArg = (res.json as any).mock.calls[0][0];
    expect(callArg.data.cases[0].status).toBe('closed');
  });

  it('passes onlyOpen=true by default to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest() as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyOpen: true,
        limit: 50,
        offset: 0,
      })
    );
  });

  it('passes onlyOpen=false when open=false query param', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ open: 'false' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyOpen: false,
        limit: 50,
        offset: 0,
      })
    );
  });

  it('returns 500 when database error occurs', async () => {
    mockListConversations.mockRejectedValue(new Error('Database connection failed'));

    const req = createRequest() as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'internal_error',
        message: 'Error listing cases',
      })
    );
  });

  it('forwards q param to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ q: 'García' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(expect.objectContaining({ q: 'García' }));
  });

  it('forwards tribunal param to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ tribunal: 'Laboral de Santiago' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(expect.objectContaining({ tribunal: 'Laboral de Santiago' }));
  });

  it('forwards etapa param to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ etapa: 'cobranza' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(expect.objectContaining({ etapa: 'cobranza' }));
  });

  it('forwards case_state param to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ case_state: 'desistido' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(expect.objectContaining({ case_state: 'desistido' }));
  });

  it('forwards from and to date params to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ from: '2026-01-01', to: '2026-05-31' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-01-01', to: '2026-05-31' })
    );
  });

  it('forwards limit and offset params to listConversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ limit: '20', offset: '40' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 40 })
    );
  });
});
