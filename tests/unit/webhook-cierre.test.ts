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
  updateConversationMetadata: vi.fn().mockResolvedValue({}),
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

    const body = { causa_id: 'nonexistent-causa', sub_etapa: 'Pago' };
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
      sub_etapa: 'Pago',
      fecha_cierre: '2026-05-30',
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
        rdd_action: 'closed',
        motivo_cierre: 'pago_total',
      })
    );

    expect(closeConversation).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      'webhook_sistema'
    );
  });

  it('handles optional fields gracefully', async () => {
    const body = { causa_id: 'test-123', sub_etapa: 'Desistimiento' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        rdd_action: 'closed',
        motivo_cierre: 'desistimiento',
      })
    );
  });

  it('keeps conversation active for Acuerdo sub_etapa', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = { causa_id: 'test-123', sub_etapa: 'Acuerdo' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        rdd_action: 'kept_active',
      })
    );

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      expect.objectContaining({ sub_etapa_saas: 'Acuerdo' })
    );
  });

  it('rejects invalid sub_etapa', async () => {
    const body = { causa_id: 'test-123', sub_etapa: 'InvalidEtapa' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('sub_etapa inválida'),
      })
    );
  });

  it('closes conversation with Caducada sub_etapa', async () => {
    const { closeConversation } = await import('@database/models');
    vi.mocked(closeConversation).mockClear();

    const body = { causa_id: 'test-123', sub_etapa: 'Caducada' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        rdd_action: 'closed',
        motivo_cierre: 'caducada',
      })
    );

    expect(closeConversation).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      'webhook_sistema'
    );
  });

  it('Acuerdo maintains case active and does not close', async () => {
    const { updateConversationMetadata, closeConversation } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();
    vi.mocked(closeConversation).mockClear();

    const body = { causa_id: 'test-123', sub_etapa: 'Acuerdo' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        rdd_action: 'kept_active',
      })
    );

    // Verify metadata was updated
    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      expect.objectContaining({ sub_etapa_saas: 'Acuerdo' })
    );

    // Verify close was NOT called
    expect(closeConversation).not.toHaveBeenCalled();
  });

  it('updates metadata correctly for Pago sub_etapa', async () => {
    const { updateConversationMetadata, closeConversation } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();
    vi.mocked(closeConversation).mockClear();

    const body = {
      causa_id: 'test-123',
      sub_etapa: 'Pago',
      fecha_cierre: '2026-05-29',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        case_state: 'cerrada',
        motivo_cierre: 'pago_total',
        sub_etapa_saas: 'Pago',
      }
    );

    expect(closeConversation).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      'webhook_sistema'
    );
  });

  it('updates metadata correctly for Desistimiento sub_etapa', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      sub_etapa: 'Desistimiento',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        case_state: 'cerrada',
        motivo_cierre: 'desistimiento',
        sub_etapa_saas: 'Desistimiento',
      }
    );
  });

  it('requires causa_id to be present and non-empty', async () => {
    const body = { sub_etapa: 'Pago' };
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

  it('requires sub_etapa to be present', async () => {
    const body = { causa_id: 'test-123' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('sub_etapa'),
      })
    );
  });

  it('handles edge case: Acuerdo with optional fecha_cierre', async () => {
    const { updateConversationMetadata, closeConversation } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();
    vi.mocked(closeConversation).mockClear();

    const body = {
      causa_id: 'test-123',
      sub_etapa: 'Acuerdo',
      fecha_cierre: '2026-05-29',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoCierreHandler(req, res);

    // Should still keep active despite fecha_cierre
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rdd_action: 'kept_active',
      })
    );
    expect(closeConversation).not.toHaveBeenCalled();
  });
});
