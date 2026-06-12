import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@test.iam.gserviceaccount.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-id',
  }),
}));

const mockLimit = vi.fn();

vi.mock('@database/supabase', () => ({
  getDb: () => ({
    from: () => ({
      select: () => ({
        limit: mockLimit,
      }),
    }),
  }),
}));

import { readyHandler } from '@api/health';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('readyHandler (GET /health/ready)', () => {
  beforeEach(() => {
    mockLimit.mockReset();
  });

  it('returns 200 ok when Supabase is reachable and Google config is present', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    const res = createResponse() as any;

    await readyHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        services: { supabase: true, google_config: true },
      })
    );
  });

  it('returns 503 degraded when Supabase query returns an error', async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    const res = createResponse() as any;

    await readyHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        services: { supabase: false, google_config: true },
      })
    );
  });

  it('returns 503 degraded when Supabase client throws', async () => {
    mockLimit.mockRejectedValue(new Error('network down'));
    const res = createResponse() as any;

    await readyHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        services: expect.objectContaining({ supabase: false }),
      })
    );
  });
});
