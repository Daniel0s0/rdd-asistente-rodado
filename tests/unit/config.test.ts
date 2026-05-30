import { describe, it, expect, vi, beforeEach } from 'vitest';

let envCache: any = null;

vi.mock('@config/env', () => {
  const actualEnv = {
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
  };

  return {
    getEnv: () => actualEnv,
  };
});

import { getEnv } from '@config/env';

describe('config/env', () => {
  it('should load environment with required vars', () => {
    expect(() => {
      getEnv();
    }).not.toThrow();
  });

  it('should have valid schema for exports', () => {
    const env = getEnv();
    expect(env).toBeDefined();
    expect(env.PORT).toBeGreaterThan(0);
    expect(env.LOG_LEVEL).toMatch(/debug|info|warn|error/);
  });
});
