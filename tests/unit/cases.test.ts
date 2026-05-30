import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

const mockListConversations = vi.fn();

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
    DATABASE_TYPE: 'sqlite',
    DATABASE_PATH: ':memory:',
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
  listConversations: mockListConversations,
}));

import { casesHandler } from '@api/cases';

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
        created_at: new Date('2026-05-01'),
        closed_at: null,
        metadata: { demandado: 'John Doe', monto_demanda: 500000 },
      },
      {
        id: 'conv-2',
        causa_id: '2024-00002',
        created_at: new Date('2026-05-02'),
        closed_at: null,
        metadata: { demandado: 'Jane Smith', monto_demanda: 1000000 },
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
          cases: [
            {
              causaId: '2024-00001',
              status: 'active',
              createdAt: '2026-05-01T00:00:00.000Z',
              metadata: { demandado: 'John Doe', monto_demanda: 500000 },
            },
            {
              causaId: '2024-00002',
              status: 'active',
              createdAt: '2026-05-02T00:00:00.000Z',
              metadata: { demandado: 'Jane Smith', monto_demanda: 1000000 },
            },
          ],
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

    expect(mockListConversations).toHaveBeenCalledWith({
      onlyOpen: true,
      limit: 50,
    });
  });

  it('passes onlyOpen=false when open=false query param', async () => {
    mockListConversations.mockResolvedValue([]);

    const req = createRequest({ open: 'false' }) as Request;
    const res = createResponse() as Response;

    await casesHandler(req, res);

    expect(mockListConversations).toHaveBeenCalledWith({
      onlyOpen: false,
      limit: 50,
    });
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
});
