import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { webhookCausaNuevaHandler } from '@api/webhook';

vi.mock('@sheets/client', () => ({
  appendRegistroRow: vi.fn(async () => 'A42'),
}));

const TEST_SECRET = 'test_webhook_secret';

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
      drive_folder_id: 'folder_abc123xyz',
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
        sheets_row_id: expect.stringMatching(/^[A-Z]+\d+$/),
        message: 'Causa registrada. ¿Cuál es el resultado del juicio?',
      })
    );
  });

  it('processes valid webhook with only required fields', async () => {
    const body = {
      causa_id: 'minimal-123',
      cliente_nombre: 'Cliente Minimal',
      drive_folder_id: 'folder_minimal',
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
      })
    );
  });
});
