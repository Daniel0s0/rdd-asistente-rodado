import { describe, it, expect, vi } from 'vitest';

vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  }),
}));

import { requestIdMiddleware } from '@middleware/request-id';
import { requestContext } from '@utils/logger';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createReq(headers: Record<string, string> = {}) {
  return { headers } as any;
}

function createRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as any;
}

describe('requestIdMiddleware', () => {
  it('generates a UUID requestId and sets x-request-id response header', () => {
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(UUID_REGEX));
  });

  it('respects an incoming x-request-id header for cross-service correlation', () => {
    const req = createReq({ 'x-request-id': 'saas-correlation-id-123' });
    const res = createRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'saas-correlation-id-123');
  });

  it('ignores an incoming x-request-id longer than 128 chars and generates a UUID', () => {
    const req = createReq({ 'x-request-id': 'x'.repeat(129) });
    const res = createRes();
    const next = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', expect.stringMatching(UUID_REGEX));
  });

  it('makes the requestId available via requestContext inside the request lifecycle', () => {
    const req = createReq();
    const res = createRes();
    let storeInsideNext: { requestId: string } | undefined;
    const next = vi.fn(() => {
      storeInsideNext = requestContext.getStore();
    });

    requestIdMiddleware(req, res, next);

    expect(storeInsideNext).toBeDefined();
    expect(storeInsideNext!.requestId).toMatch(UUID_REGEX);
    expect(res.headers['x-request-id']).toBe(storeInsideNext!.requestId);
  });

  it('keeps the requestId across async continuations within the same request', async () => {
    const req = createReq();
    const res = createRes();
    let asyncStore: { requestId: string } | undefined;

    await new Promise<void>((resolve) => {
      requestIdMiddleware(req, res, () => {
        setTimeout(() => {
          asyncStore = requestContext.getStore();
          resolve();
        }, 5);
      });
    });

    expect(asyncStore?.requestId).toBe(res.headers['x-request-id']);
  });
});
