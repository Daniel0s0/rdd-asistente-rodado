import { describe, it, expect, vi } from 'vitest';
import { healthHandler } from '@api/health';

describe('health endpoint', () => {
  it('should return health status with correct properties', () => {
    const req = {} as any;
    let response: any = null;

    const res = {
      json: (body: any) => {
        response = body;
      },
    } as any;

    healthHandler(req, res);

    expect(response).toBeDefined();
    expect(response.status).toBe('ok');
    expect(response.uptime).toBeGreaterThanOrEqual(0);
    expect(response.version).toBe('0.1.0');
    expect(response.environment).toBeDefined();
    expect(response.timestamp).toBeDefined();
  });
});
