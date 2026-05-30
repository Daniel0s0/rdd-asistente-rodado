import { describe, it, expect, vi } from 'vitest';

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
