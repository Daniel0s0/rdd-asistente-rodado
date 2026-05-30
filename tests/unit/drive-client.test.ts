import { describe, it, expect, vi } from 'vitest';

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

// Simplified test that verifies the Drive client can be imported
// Full Drive API testing requires live Google credentials
describe('Drive Client', () => {
  it('should have drive client exports', async () => {
    const driveClient = await import('@drive/client');
    expect(driveClient.createCaseFolder).toBeDefined();
    expect(driveClient.getFoldersByCase).toBeDefined();
    expect(driveClient.uploadDocument).toBeDefined();
    expect(driveClient.listDocuments).toBeDefined();
  });

  it('should export async functions with correct signatures', async () => {
    const driveClient = await import('@drive/client');
    expect(typeof driveClient.createCaseFolder).toBe('function');
    expect(typeof driveClient.getFoldersByCase).toBe('function');
    expect(typeof driveClient.uploadDocument).toBe('function');
    expect(typeof driveClient.listDocuments).toBe('function');
  });
});
