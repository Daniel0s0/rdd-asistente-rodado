/**
 * tool-handlers.test.ts — Unit Tests for Tool Handlers (Tool Use Execution)
 *
 * Strategy:
 *   - Mock @database/models functions (createRegistro, createAcuerdo, etc.)
 *   - Mock @utils/logger
 *   - Test executeTool() function with all tool types
 *   - Verify error handling and validation
 *   - Test processToolUseBlocks() orchestration
 *
 * Covered cases:
 *   - create_registro: Valid input, error handling
 *   - create_acuerdo: Valid input, validation (negative monto, invalid %)
 *   - mark_cuota_pagada: Success flow
 *   - get_caso_estado: With/without acuerdos
 *   - close_case: With reason and notes
 *   - Unknown tool: Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeTool, processToolUseBlocks } from '@agent/tool-handlers';
import * as models from '@database/models';
import { logger } from '@utils/logger';

// ─── Mock env BEFORE importing ───────────────────────────────────────────────
vi.mock('@config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'test',
    PORT: 3001,
    LOG_LEVEL: 'info',
    SAAS_WEBHOOK_SECRET: 'test_secret',
    SAAS_API_URL: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    CLAUDE_MODEL: 'claude-3-5-sonnet-20241022',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
    GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: 'test-key',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'test-sheet-id',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'test-folder-id',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    CLAUDE_MAX_CONTEXT_TURNS: 10,
    CLAUDE_TEMPERATURE: 0.3,
    GOOGLE_API_TIMEOUT: 30000,
    GOOGLE_API_MAX_RETRIES: 3,
    UI_API_KEY: 'test_api_key_min_32_chars_long_enough',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEBHOOK_RATE_LIMIT: 100,
    CHAT_RATE_LIMIT: 30,
    ENABLE_AUDIT_LOGGING: true,
    ENABLE_DETAILED_LOGGING: false,
  }),
}));

// ─── Mock database models ─────────────────────────────────────────────────────
vi.mock('@database/models', () => ({
  createRegistro: vi.fn(),
  createAcuerdo: vi.fn(),
  createCuotas: vi.fn(),
  markCuotaPagada: vi.fn(),
  getAcuerdosActivos: vi.fn(),
  getCuotasByAcuerdo: vi.fn(),
  updateConversationMetadata: vi.fn(),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Mock calculateCuotaDates ─────────────────────────────────────────────────
vi.mock('@agent/claude-agent', () => ({
  calculateCuotaDates: vi.fn((fecha: string, count: number) => {
    const dates = [];
    const baseDate = new Date(fecha);
    for (let i = 0; i < count; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }),
}));

describe('Tool Handlers', () => {
  const conversationId = 'conv-test-123';
  const toolUseId = 'tool-use-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // create_registro Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('create_registro', () => {
    it('should execute successfully with valid input', async () => {
      const mockRegistro = { id: 'reg-001', created_at: '2026-05-31' };
      vi.mocked(models.createRegistro).mockResolvedValue(mockRegistro as any);

      const result = await executeTool(
        'create_registro',
        toolUseId,
        {
          tipo: 'cobranza',
          monto: 500000,
          fecha: '2026-05-31',
        },
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.tool_name).toBe('create_registro');
      expect(result.tool_use_id).toBe(toolUseId);
      expect(result.content).toContain('✅');
      expect(result.content).toContain('500.000'); // ES-CL locale formatting
      expect(result.content).toContain('reg-001');
      expect(models.createRegistro).toHaveBeenCalledWith({
        conversationId,
        tipo: 'cobranza',
        monto: 500000,
        fecha: '2026-05-31',
      });
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(models.createRegistro).mockRejectedValue(dbError);

      const result = await executeTool(
        'create_registro',
        toolUseId,
        {
          tipo: 'cobranza',
          monto: 500000,
          fecha: '2026-05-31',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('Database connection failed');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should format currency correctly in response', async () => {
      const mockRegistro = { id: 'reg-002' };
      vi.mocked(models.createRegistro).mockResolvedValue(mockRegistro as any);

      const result = await executeTool(
        'create_registro',
        toolUseId,
        {
          tipo: 'pago',
          monto: 1500000,
          fecha: '2026-06-01',
        },
        conversationId
      );

      expect(result.content).toContain('1.500.000');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // create_acuerdo Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('create_acuerdo', () => {
    it('should create acuerdo with valid input', async () => {
      const mockAcuerdo = { id: 'acuerdo-001', created_at: '2026-05-31' };
      const mockCuotas = [
        { numero: 1, monto: 100000, fechaVencimiento: '2026-06-15' },
        { numero: 2, monto: 100000, fechaVencimiento: '2026-07-15' },
      ];

      vi.mocked(models.createAcuerdo).mockResolvedValue(mockAcuerdo as any);
      vi.mocked(models.createCuotas).mockResolvedValue(mockCuotas as any);

      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
          porcentajeHonorarios: 20,
        },
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('✅');
      expect(result.content).toContain('500.000'); // ES-CL locale formatting
      expect(result.content).toContain('5 cuotas');
      expect(result.content).toContain('2026-06-15');
      expect(result.content).toContain('acuerdo-001');

      expect(models.createAcuerdo).toHaveBeenCalled();
      expect(models.createCuotas).toHaveBeenCalledWith('acuerdo-001', expect.any(Array));
    });

    it('should reject negative monto', async () => {
      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: -100,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('> 0');
      expect(models.createAcuerdo).not.toHaveBeenCalled();
    });

    it('should reject zero monto', async () => {
      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 0,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
    });

    it('should reject zero cuotas', async () => {
      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 0,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
    });

    it('should reject porcentajeHonorarios > 100', async () => {
      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
          porcentajeHonorarios: 150,
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('Porcentaje');
    });

    it('should reject negative porcentajeHonorarios', async () => {
      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
          porcentajeHonorarios: -10,
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
    });

    it('should accept valid porcentajeHonorarios (0-100)', async () => {
      const mockAcuerdo = { id: 'acuerdo-002' };
      vi.mocked(models.createAcuerdo).mockResolvedValue(mockAcuerdo as any);
      vi.mocked(models.createCuotas).mockResolvedValue([] as any);

      // Test edge case: 0%
      let result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
          porcentajeHonorarios: 0,
        },
        conversationId
      );

      expect(result.isError).toBe(false);

      // Test edge case: 100%
      vi.clearAllMocks();
      vi.mocked(models.createAcuerdo).mockResolvedValue(mockAcuerdo as any);
      vi.mocked(models.createCuotas).mockResolvedValue([] as any);

      result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
          porcentajeHonorarios: 100,
        },
        conversationId
      );

      expect(result.isError).toBe(false);
    });

    it('should handle database error during createAcuerdo', async () => {
      vi.mocked(models.createAcuerdo).mockRejectedValue(
        new Error('Acuerdo creation failed')
      );

      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Acuerdo creation failed');
    });

    it('should handle database error during createCuotas', async () => {
      const mockAcuerdo = { id: 'acuerdo-003' };
      vi.mocked(models.createAcuerdo).mockResolvedValue(mockAcuerdo as any);
      vi.mocked(models.createCuotas).mockRejectedValue(
        new Error('Cuotas creation failed')
      );

      const result = await executeTool(
        'create_acuerdo',
        toolUseId,
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Cuotas creation failed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // mark_cuota_pagada Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('mark_cuota_pagada', () => {
    it('should mark cuota as paid successfully', async () => {
      vi.mocked(models.markCuotaPagada).mockResolvedValue(undefined);

      const result = await executeTool(
        'mark_cuota_pagada',
        toolUseId,
        {
          acuerdoId: 'acuerdo-001',
          numeroCuota: 1,
          fecha: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('✅');
      expect(result.content).toContain('Cuota #1');
      expect(result.content).toContain('2026-06-15');
      expect(models.markCuotaPagada).toHaveBeenCalledWith(
        'acuerdo-001',
        1,
        '2026-06-15'
      );
    });

    it('should reject missing acuerdoId', async () => {
      const result = await executeTool(
        'mark_cuota_pagada',
        toolUseId,
        {
          acuerdoId: '',
          numeroCuota: 1,
          fecha: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('acuerdoId');
    });

    it('should reject undefined acuerdoId', async () => {
      const result = await executeTool(
        'mark_cuota_pagada',
        toolUseId,
        {
          numeroCuota: 1,
          fecha: '2026-06-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
    });

    it('should handle database error', async () => {
      vi.mocked(models.markCuotaPagada).mockRejectedValue(
        new Error('Update failed')
      );

      const result = await executeTool(
        'mark_cuota_pagada',
        toolUseId,
        {
          acuerdoId: 'acuerdo-001',
          numeroCuota: 2,
          fecha: '2026-07-15',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Update failed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // get_caso_estado Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('get_caso_estado', () => {
    it('should return acuerdos when they exist', async () => {
      // Fixtures con el shape REAL de las filas (snake_case, como AcuerdoRecord/CuotaRecord)
      const mockAcuerdos = [
        {
          id: 'acuerdo-001',
          conversation_id: conversationId,
          monto_total: 500000,
          cuotas_total: 5,
          monto_por_cuota: 100000,
          porcentaje_honorarios: 20,
          fecha_primer_pago: '2026-05-15',
          estado: 'activo',
          created_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 'acuerdo-002',
          conversation_id: conversationId,
          monto_total: 300000,
          cuotas_total: 3,
          monto_por_cuota: 100000,
          porcentaje_honorarios: 20,
          fecha_primer_pago: '2026-06-01',
          estado: 'activo',
          created_at: '2026-05-20T00:00:00Z',
        },
      ];
      const cuota = (acuerdoId: string, numero: number, estado: string, fecha: string) => ({
        id: `${acuerdoId}-c${numero}`,
        acuerdo_id: acuerdoId,
        numero,
        monto: 100000,
        fecha_vencimiento: fecha,
        fecha_pago: estado.startsWith('pagada') ? fecha : null,
        estado,
        created_at: '2026-05-01T00:00:00Z',
      });
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue(mockAcuerdos as any);
      vi.mocked(models.getCuotasByAcuerdo)
        .mockResolvedValueOnce([
          cuota('acuerdo-001', 1, 'pagada', '2026-05-15'),
          cuota('acuerdo-001', 2, 'pagada_con_retraso', '2026-06-15'),
          cuota('acuerdo-001', 3, 'pendiente', '2026-07-15'),
          cuota('acuerdo-001', 4, 'pendiente', '2026-08-15'),
          cuota('acuerdo-001', 5, 'pendiente', '2026-09-15'),
        ] as any)
        .mockResolvedValueOnce([
          cuota('acuerdo-002', 1, 'pagada', '2026-06-01'),
          cuota('acuerdo-002', 2, 'vencida', '2026-08-01'),
          cuota('acuerdo-002', 3, 'pendiente', '2026-09-01'),
        ] as any);

      const result = await executeTool(
        'get_caso_estado',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('Acuerdos activos');
      expect(result.content).toContain('500.000'); // ES-CL locale formatting
      expect(result.content).toContain('2/5');
      expect(result.content).toContain('1/3');
      expect(result.content).toContain('2026-07-15');
      expect(result.content).toContain('2026-08-01');
      expect(models.getAcuerdosActivos).toHaveBeenCalledWith(conversationId);
      expect(models.getCuotasByAcuerdo).toHaveBeenCalledWith('acuerdo-001');
      expect(models.getCuotasByAcuerdo).toHaveBeenCalledWith('acuerdo-002');
    });

    it('should return informational message when no acuerdos exist', async () => {
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue([]);

      const result = await executeTool(
        'get_caso_estado',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('No hay acuerdos');
      expect(result.content).toContain('ℹ️');
    });

    it('should handle database error', async () => {
      vi.mocked(models.getAcuerdosActivos).mockRejectedValue(
        new Error('Query failed')
      );

      const result = await executeTool(
        'get_caso_estado',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Query failed');
    });

    it('should format large amounts with locale formatting', async () => {
      const mockAcuerdos = [
        {
          id: 'acuerdo-001',
          conversation_id: conversationId,
          monto_total: 1500000,
          cuotas_total: 5,
          monto_por_cuota: 300000,
          porcentaje_honorarios: 20,
          fecha_primer_pago: '2026-06-15',
          estado: 'activo',
          created_at: '2026-05-01T00:00:00Z',
        },
      ];
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue(mockAcuerdos as any);
      vi.mocked(models.getCuotasByAcuerdo).mockResolvedValue([] as any);

      const result = await executeTool(
        'get_caso_estado',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('1.500.000');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // close_case Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('close_case', () => {
    it('should close case with reason and notes', async () => {
      vi.mocked(models.updateConversationMetadata).mockResolvedValue(undefined);

      const result = await executeTool(
        'close_case',
        toolUseId,
        {
          motivo_cierre: 'pago_total',
          notas: 'Todas las cuotas pagadas correctamente',
        },
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('✅');
      expect(result.content).toContain('pago total recibido');
      expect(result.content).toContain('Todas las cuotas pagadas correctamente');
      expect(models.updateConversationMetadata).toHaveBeenCalledWith(
        conversationId,
        { case_state: 'cerrada', motivo_cierre: 'pago_total' }
      );
    });

    it('should close case with reason but no notes', async () => {
      vi.mocked(models.updateConversationMetadata).mockResolvedValue(undefined);

      const result = await executeTool(
        'close_case',
        toolUseId,
        {
          motivo_cierre: 'desistimiento',
        },
        conversationId
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain('✅');
      expect(result.content).toContain('desistimiento del cliente');
      expect(result.content).not.toContain('Notas');
    });

    it('should handle database error', async () => {
      vi.mocked(models.updateConversationMetadata).mockRejectedValue(
        new Error('Update failed')
      );

      const result = await executeTool(
        'close_case',
        toolUseId,
        {
          razonCierre: 'pagado_completo',
        },
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Update failed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Unknown Tool Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('should return error for unknown tool', async () => {
      const result = await executeTool(
        'unknown_tool',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('Unknown tool');
      expect(result.content).toContain('unknown_tool');
    });

    it('should return error for malformed tool name', async () => {
      const result = await executeTool(
        'create_invalid',
        toolUseId,
        {},
        conversationId
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // processToolUseBlocks Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('processToolUseBlocks', () => {
    it('should process multiple tool use blocks in parallel', async () => {
      vi.mocked(models.createRegistro).mockResolvedValue({ id: 'reg-001' } as any);
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue([] as any);

      const toolUseBlocks = [
        {
          id: 'tool-001',
          name: 'create_registro',
          input: { tipo: 'cobranza', monto: 100000, fecha: '2026-05-31' },
        },
        {
          id: 'tool-002',
          name: 'get_caso_estado',
          input: {},
        },
      ];

      const results = await processToolUseBlocks(toolUseBlocks, conversationId);

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(false);
      expect(results[0].tool_name).toBe('create_registro');
      expect(results[0].tool_use_id).toBe('tool-001');
      expect(results[1].isError).toBe(false);
      expect(results[1].tool_name).toBe('get_caso_estado');
      expect(results[1].tool_use_id).toBe('tool-002');
    });

    it('should handle errors in individual blocks without stopping others', async () => {
      vi.mocked(models.createRegistro).mockRejectedValue(new Error('DB error'));
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue([] as any);

      const toolUseBlocks = [
        {
          id: 'tool-001',
          name: 'create_registro',
          input: { tipo: 'cobranza', monto: 100000, fecha: '2026-05-31' },
        },
        {
          id: 'tool-002',
          name: 'get_caso_estado',
          input: {},
        },
      ];

      const results = await processToolUseBlocks(toolUseBlocks, conversationId);

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain('DB error');
      expect(results[1].isError).toBe(false); // Second tool should still succeed
    });

    it('should process empty tool use blocks array', async () => {
      const results = await processToolUseBlocks([], conversationId);

      expect(results).toEqual([]);
    });

    it('should preserve tool_use_id in all results', async () => {
      vi.mocked(models.createAcuerdo).mockResolvedValue({ id: 'acuerdo-001' } as any);
      vi.mocked(models.createCuotas).mockResolvedValue([] as any);

      const toolUseBlocks = [
        {
          id: 'unique-id-123',
          name: 'create_acuerdo',
          input: {
            montoTotal: 500000,
            cuotasTotal: 5,
            fechaPrimerPago: '2026-06-15',
          },
        },
      ];

      const results = await processToolUseBlocks(toolUseBlocks, conversationId);

      expect(results[0].tool_use_id).toBe('unique-id-123');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Integration Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe('integration scenarios', () => {
    it('should handle typical workflow: register acuerdo → check status', async () => {
      // Create acuerdo
      const mockAcuerdo = { id: 'acuerdo-001' };
      vi.mocked(models.createAcuerdo).mockResolvedValue(mockAcuerdo as any);
      vi.mocked(models.createCuotas).mockResolvedValue([] as any);

      const createResult = await executeTool(
        'create_acuerdo',
        'tool-001',
        {
          montoTotal: 500000,
          cuotasTotal: 5,
          fechaPrimerPago: '2026-06-15',
        },
        conversationId
      );

      expect(createResult.isError).toBe(false);

      // Check status
      const mockAcuerdos = [
        {
          id: 'acuerdo-001',
          conversation_id: conversationId,
          monto_total: 500000,
          cuotas_total: 5,
          monto_por_cuota: 100000,
          porcentaje_honorarios: 20,
          fecha_primer_pago: '2026-06-15',
          estado: 'activo',
          created_at: '2026-05-01T00:00:00Z',
        },
      ];
      vi.mocked(models.getAcuerdosActivos).mockResolvedValue(mockAcuerdos as any);
      vi.mocked(models.getCuotasByAcuerdo).mockResolvedValue([
        {
          id: 'c1',
          acuerdo_id: 'acuerdo-001',
          numero: 1,
          monto: 100000,
          fecha_vencimiento: '2026-06-15',
          fecha_pago: null,
          estado: 'pendiente',
          created_at: '2026-05-01T00:00:00Z',
        },
      ] as any);

      const statusResult = await executeTool(
        'get_caso_estado',
        'tool-002',
        {},
        conversationId
      );

      expect(statusResult.isError).toBe(false);
      expect(statusResult.content).toContain('0/5');
    });

    it('should handle workflow: register pago → check status → close case', async () => {
      // Mark payment
      vi.mocked(models.markCuotaPagada).mockResolvedValue(undefined);

      const payResult = await executeTool(
        'mark_cuota_pagada',
        'tool-001',
        {
          acuerdoId: 'acuerdo-001',
          numeroCuota: 1,
          fecha: '2026-06-15',
        },
        conversationId
      );

      expect(payResult.isError).toBe(false);

      // Close case
      vi.mocked(models.updateConversationMetadata).mockResolvedValue(undefined);

      const closeResult = await executeTool(
        'close_case',
        'tool-002',
        {
          razonCierre: 'pagado_completo',
        },
        conversationId
      );

      expect(closeResult.isError).toBe(false);
    });
  });
});
