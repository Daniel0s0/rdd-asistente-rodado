import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { webhookCausaNuevaHandler } from '@api/webhook';

vi.mock('@sheets/client', () => ({
  appendRegistroRow: vi.fn(async () => 'A42'),
}));

vi.mock('@database/models', () => ({
  createConversation: vi.fn().mockResolvedValue({
    id: 'mock-conversation-uuid-unit-test',
    causa_id: 'test-causa-id',
    created_at: new Date(),
    closed_at: null,
    metadata: {},
  }),
}));

const TEST_SECRET = 'test_webhook_secret';

describe('webhookCausaNuevaHandler', () => {
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

  it('rejects missing x-webhook-signature header', async () => {
    const body = {
      causa_id: 'test-123',
      cliente_nombre: 'Test',
      drive_folder_id: 'folder_xyz',
    };
    const req = createRequest(body) as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects invalid webhook signature', async () => {
    const body = {
      causa_id: 'test-123',
      cliente_nombre: 'Test',
      drive_folder_id: 'folder_xyz',
    };
    const req = createRequest(body, 'invalid_signature_here') as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'invalid_signature',
      })
    );
  });

  it('rejects payload missing causa_id', async () => {
    const body = {
      cliente_nombre: 'Test',
      drive_folder_id: 'folder_xyz',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature, {
      NODE_ENV: 'test',
      SAAS_WEBHOOK_SECRET: TEST_SECRET,
    }) as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('causa_id'),
      })
    );
  });

  it('rejects payload missing cliente_nombre', async () => {
    const body = {
      causa_id: 'test-123',
      drive_folder_id: 'folder_xyz',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('cliente_nombre'),
      })
    );
  });

  it('rejects payload missing drive_folder_id', async () => {
    const body = {
      causa_id: 'test-123',
      cliente_nombre: 'Test',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'validation_error',
        message: expect.stringContaining('drive_folder_id'),
      })
    );
  });

  it('accepts valid payload with correct signature', async () => {
    const body = {
      causa_id: 'test-123',
      cliente_nombre: 'Test Client',
      drive_folder_id: 'folder_xyz',
      cliente_rut: '12345678-9',
      demandado: 'John Doe',
      rit: 'RIT-2024-001',
      tribunal: 'Juzgado de Santiago',
    };
    const signature = generateSignature(body);
    const req = createRequest(body, signature) as any;
    const res = createResponse() as any;

    await webhookCausaNuevaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        causa_id: 'test-123',
        sheets_row_id: 'A42',
        message: expect.stringContaining('Causa registrada'),
      })
    );
  });
});
