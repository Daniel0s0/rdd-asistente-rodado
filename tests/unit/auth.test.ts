import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

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

import { requireApiKey } from '@middleware/auth';

describe('requireApiKey middleware', () => {
  function createRequest(authHeader?: string): Partial<Request> {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
    };
  }

  function createResponse(): Partial<Response> {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  }

  function createNext(): NextFunction {
    return vi.fn();
  }

  it('rejects request missing Authorization header', () => {
    const req = createRequest() as Request;
    const res = createResponse() as Response;
    const next = createNext();

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'unauthorized',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects request with invalid Authorization header format', () => {
    const req = createRequest('InvalidFormat') as Request;
    const res = createResponse() as Response;
    const next = createNext();

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'unauthorized',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects request with wrong API key', () => {
    const req = createRequest('Bearer wrong_api_key') as Request;
    const res = createResponse() as Response;
    const next = createNext();

    requireApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'unauthorized',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows request with correct API key', () => {
    const req = createRequest('Bearer test_api_key_min_32_chars_long_enough') as Request;
    const res = createResponse() as Response;
    const next = createNext();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('is case-insensitive for Bearer prefix', () => {
    const req = createRequest('bearer test_api_key_min_32_chars_long_enough') as Request;
    const res = createResponse() as Response;
    const next = createNext();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
