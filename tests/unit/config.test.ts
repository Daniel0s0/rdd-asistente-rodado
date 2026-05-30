import { describe, it, expect, vi } from 'vitest';
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
