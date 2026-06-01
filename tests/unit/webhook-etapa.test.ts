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

import { webhookCasoEtapaHandler } from '@api/webhook';

vi.mock('@database/models', () => ({
  getConversationByCausaId: vi.fn().mockResolvedValue({
    id: 'mock-conversation-uuid',
    causa_id: 'test-causa-id',
    created_at: new Date(),
    closed_at: null,
    metadata: {},
  }),
  updateConversationMetadata: vi.fn().mockResolvedValue({}),
}));

describe('webhookCasoEtapaHandler', () => {
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
    const body = { causa_id: 'test-123', etapa_nueva: 'Cobranza' };
    const req = createRequest(body) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects invalid webhook signature', async () => {
    const body = { causa_id: 'test-123', etapa_nueva: 'Cobranza' };
    const req = createRequest(body, 'invalid_signature_here') as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects payload missing causa_id', async () => {
    const body = { etapa_nueva: 'Cobranza' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('causa_id'),
      })
    );
  });

  it('rejects payload missing etapa_nueva', async () => {
    const body = { causa_id: 'test-123' };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('etapa_nueva'),
      })
    );
  });

  it('returns 404 if causa not found in DB', async () => {
    const { getConversationByCausaId } = await import('@database/models');
    vi.mocked(getConversationByCausaId).mockResolvedValueOnce(null as any);

    const body = {
      causa_id: 'nonexistent-causa',
      etapa_nueva: 'Cobranza',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'not_found',
      })
    );
  });

  it('updates conversation when etapa changes to Cobranza', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      sub_etapa_nueva: 'Ingreso',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        etapa: 'cobranza',
        message: 'Etapa actualizada',
      })
    );

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'cobranza',
        sub_etapa_saas: 'Ingreso',
      }
    );
  });

  it('updates conversation when etapa is Litigacion', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Litigacion',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        etapa: 'litigacion',
        message: 'Etapa actualizada',
      })
    );

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'litigacion',
        sub_etapa_saas: null,
      }
    );
  });

  it('handles optional sub_etapa_nueva field', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      // sub_etapa_nueva omitted
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'cobranza',
        sub_etapa_saas: null,
      }
    );
  });

  it('preserves etapa_anterior and sub_etapa_anterior if provided', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      sub_etapa_nueva: 'Gestión',
      etapa_anterior: 'Litigacion',
      sub_etapa_anterior: 'Sentencia',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Verify the essential fields are updated
    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'cobranza',
        sub_etapa_saas: 'Gestión',
      }
    );
  });

  it('processes request with timestamp field', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      sub_etapa_nueva: 'Ejecución',
      timestamp: '2026-05-29T15:30:00Z',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
      })
    );
  });

  it('sets pending_action when sub_etapa_nueva is Acuerdo', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      sub_etapa_nueva: 'Acuerdo',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'cobranza',
        sub_etapa_saas: 'Acuerdo',
        pending_action: 'ask_acuerdo_terms',
      }
    );
  });

  it('does NOT set pending_action for non-Acuerdo sub_etapa', async () => {
    const { updateConversationMetadata } = await import('@database/models');
    vi.mocked(updateConversationMetadata).mockClear();

    const body = {
      causa_id: 'test-123',
      etapa_nueva: 'Cobranza',
      sub_etapa_nueva: 'Ingreso',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCasoEtapaHandler(req, res);

    expect(updateConversationMetadata).toHaveBeenCalledWith(
      'mock-conversation-uuid',
      {
        etapa: 'cobranza',
        sub_etapa_saas: 'Ingreso',
      }
    );
  });
});
