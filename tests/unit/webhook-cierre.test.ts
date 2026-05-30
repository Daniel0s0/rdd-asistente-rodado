import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

const TEST_SECRET = 'test_webhook_secret';

vi.mock('@config/env', () => ({
  getEnv: () => ({
    SAAS_WEBHOOK_SECRET: 'test_webhook_secret',
    LOG_LEVEL: 'silent',
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
  }),
}));

import { webhookCasoCierreHandler } from '@api/webhook';

vi.mock('@database/models', () => ({
  getConversationByCausaId: vi.fn().mockResolvedValue({
    id: 'mock-conversation-uuid',
    causa_id: 'test-causa-id',
    created_at: new Date(),
    closed_at: null,
    metadata: {},
  }),
  closeConversation: vi.fn().mockResolvedValue({
    id: 'mock-conversation-uuid',
    closed_at: new Date(),
  }),
}));

describe('webhookCasoCierreHandler', () => {
  function createRequest(
    body: unknown,
    signature?: string,
    headers: Record<string, string> = {}
  ) {
    return {
      body,
      headers: {
        ...headers,
        ...(signature && { 'x-webhook-signature': signature }),
      },
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  }

  function generateSignature(body: unknown): string {
    return crypto
      .createHmac('sha256', TEST_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  it('rejects missing webhook signature', async () => {
    const body = { causa_id: 'test-123' };
    const req = createRequest(body) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects invalid webhook signature', async () => {
    const body = { causa_id: 'test-123' };
    const req = createRequest(body, 'invalid_signature_here') as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects payload missing causa_id', async () => {
    const body = { fecha_cierre: '2026-05-30' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('causa_id'),
      })
    );
  });

  it('returns 404 if causa not found in DB', async () => {
    const { getConversationByCausaId } = await import('@database/models');
    vi.mocked(getConversationByCausaId).mockResolvedValueOnce(null as any);

    const body = { causa_id: 'nonexistent-causa' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'not_found',
      })
    );
  });

  it('closes conversation on valid payload', async () => {
    const { closeConversation } = await import('@database/models');
    vi.mocked(closeConversation).mockClear();

    const body = {
      causa_id: 'test-123',
      fecha_cierre: '2026-05-30',
      motivo: 'Sentencia favorable',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        message: 'Caso cerrado',
      })
    );

    expect(closeConversation).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      'webhook_sistema'
    );
  });

  it('handles optional fields gracefully', async () => {
    const body = { causa_id: 'test-123' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        message: 'Caso cerrado',
      })
    );
  });
});
