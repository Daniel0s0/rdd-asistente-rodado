import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { webhookCausaNuevaHandler } from '@api/webhook';

const TEST_SECRET = 'test_webhook_secret';

vi.mock('@sheets/client', () => ({
  appendRegistroRow: vi.fn(async () => 'A42'),
}));

vi.mock('@database/models', () => ({
  createConversation: vi.fn().mockResolvedValue({
    id: 'mock-conversation-uuid-integration-test',
    causa_id: 'test-causa-id',
    created_at: new Date(),
    closed_at: null,
    metadata: {},
  }),
  // Causa no existe → camino feliz (el check de idempotencia la deja pasar)
  getConversationByCausaId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@drive/client', () => ({
  createCaseFolder: vi.fn().mockResolvedValue({
    folderId: 'mock-folder-id',
    webViewLink: 'https://drive.google.com/drive/folders/mock-folder-id',
    porResolverFolderId: 'mock-por-resolver-id',
    resueltosFolderId: 'mock-resueltos-id',
  }),
}));

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

describe('Webhook Integration', () => {
  function generateSignature(body: unknown): string {
    return crypto
      .createHmac('sha256', TEST_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  it('processes valid webhook with all optional fields', async () => {
    const body = {
      causa_id: 'cause-456',
      cliente_id: 'client-001',
      cliente_nombre: 'Empresa ABC Ltda.',
      cliente_rut: '76123456-7',
      demandado: 'Juan Pérez González',
      rit: 'RIT-2024-001234',
      tribunal: 'Juzgado de Letras en lo Civil de Santiago',
    };

    const signature = generateSignature(body);

    const req = {
      body,
      headers: {
        'x-webhook-signature': signature,
        'content-type': 'application/json',
      },
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'cause-456',
        sheets_row_id: 'A42',
        drive_folder_id: 'mock-folder-id',
        conversation_id: expect.any(String),
        message: expect.stringContaining('Causa registrada'),
      })
    );
  });

  it('processes valid webhook with only required fields', async () => {
    const body = {
      causa_id: 'minimal-123',
      cliente_nombre: 'Cliente Minimal',
    };

    const signature = generateSignature(body);

    const req = {
      body,
      headers: {
        'x-webhook-signature': signature,
      },
    } as any;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'minimal-123',
        sheets_row_id: 'A42',
        drive_folder_id: 'mock-folder-id',
        conversation_id: expect.any(String),
      })
    );
  });
});
