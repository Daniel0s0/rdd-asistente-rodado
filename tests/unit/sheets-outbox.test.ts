import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@database/models', () => ({
  createOutboxEntry: vi.fn(),
  getOutboxPendientes: vi.fn(),
  markOutboxProcesado: vi.fn(),
  markOutboxFallido: vi.fn(),
}));

vi.mock('@sheets/client', () => ({
  appendRegistroRow: vi.fn(),
  updateRegistroRow: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  enqueueSheetsOperation,
  processSheetsOutbox,
  MAX_INTENTOS,
} from '@sheets/outbox';
import * as models from '@database/models';
import * as sheets from '@sheets/client';

function entry(overrides: Partial<models.SheetsOutboxEntry> = {}): models.SheetsOutboxEntry {
  return {
    id: 'outbox-001',
    operation: 'append_registro',
    causa_id: 'causa-123',
    payload: { causaId: 'causa-123', clienteNombre: 'Test' },
    estado: 'pendiente',
    intentos: 0,
    ultimo_error: null,
    created_at: '2026-06-12T00:00:00Z',
    processed_at: null,
    ...overrides,
  };
}

describe('sheets outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueueSheetsOperation', () => {
    it('persists the operation and returns true', async () => {
      vi.mocked(models.createOutboxEntry).mockResolvedValue(entry());

      const ok = await enqueueSheetsOperation('append_registro', 'causa-123', { a: 1 });

      expect(ok).toBe(true);
      expect(models.createOutboxEntry).toHaveBeenCalledWith('append_registro', 'causa-123', {
        a: 1,
      });
    });

    it('returns false without throwing when the DB insert fails', async () => {
      vi.mocked(models.createOutboxEntry).mockRejectedValue(new Error('db down'));

      const ok = await enqueueSheetsOperation('update_registro', 'causa-123', { a: 1 });

      expect(ok).toBe(false);
    });
  });

  describe('processSheetsOutbox', () => {
    it('processes an append_registro entry and marks it procesado', async () => {
      vi.mocked(models.getOutboxPendientes).mockResolvedValue([entry()]);
      vi.mocked(sheets.appendRegistroRow).mockResolvedValue('A42');

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 1, fallidos: 0 });
      expect(sheets.appendRegistroRow).toHaveBeenCalledWith(
        expect.objectContaining({ causaId: 'causa-123' })
      );
      expect(models.markOutboxProcesado).toHaveBeenCalledWith('outbox-001');
    });

    it('maps an acuerdo payload to the column names updateRegistroRow expects', async () => {
      vi.mocked(models.getOutboxPendientes).mockResolvedValue([
        entry({
          id: 'outbox-002',
          operation: 'update_registro',
          payload: {
            intent: 'acuerdo',
            monto: 500000,
            cuotas: 5,
            fecha: '2026-07-01',
            porcentajeHonorarios: 20,
          },
        }),
      ]);
      vi.mocked(sheets.updateRegistroRow).mockResolvedValue(undefined);

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 1, fallidos: 0 });
      // CRÍTICO: updateRegistroRow espera acuerdoMonto/acuerdoCuotas/acuerdoFecha,
      // no los nombres crudos de buildSheetsSyncData (monto/cuotas/fecha)
      expect(sheets.updateRegistroRow).toHaveBeenCalledWith('causa-123', {
        tipoIngreso: 'acuerdo',
        acuerdoMonto: 500000,
        acuerdoCuotas: 5,
        acuerdoFecha: '2026-07-01',
        porcentajeHonorarios: 20,
      });
      expect(models.markOutboxProcesado).toHaveBeenCalledWith('outbox-002');
    });

    it('maps a pago payload to montoPago/fechaPago', async () => {
      vi.mocked(models.getOutboxPendientes).mockResolvedValue([
        entry({
          id: 'outbox-003',
          operation: 'update_registro',
          payload: { intent: 'pago', monto: 100000, fecha: '2026-06-20' },
        }),
      ]);
      vi.mocked(sheets.updateRegistroRow).mockResolvedValue(undefined);

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 1, fallidos: 0 });
      expect(sheets.updateRegistroRow).toHaveBeenCalledWith('causa-123', {
        tipoIngreso: 'pago',
        montoPago: 100000,
        fechaPago: '2026-06-20',
        porcentajeHonorarios: undefined,
      });
    });

    it('marks the entry fallido with incremented intentos when Sheets fails', async () => {
      vi.mocked(models.getOutboxPendientes).mockResolvedValue([entry({ intentos: 1 })]);
      vi.mocked(sheets.appendRegistroRow).mockRejectedValue(new Error('quota exceeded'));

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 0, fallidos: 1 });
      expect(models.markOutboxFallido).toHaveBeenCalledWith(
        'outbox-001',
        2,
        'quota exceeded',
        MAX_INTENTOS
      );
      expect(models.markOutboxProcesado).not.toHaveBeenCalled();
    });

    it('continues with remaining entries after one fails', async () => {
      vi.mocked(models.getOutboxPendientes).mockResolvedValue([
        entry({ id: 'outbox-bad' }),
        entry({ id: 'outbox-good' }),
      ]);
      vi.mocked(sheets.appendRegistroRow)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('A43');

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 1, fallidos: 1 });
      expect(models.markOutboxFallido).toHaveBeenCalledWith('outbox-bad', 1, 'boom', MAX_INTENTOS);
      expect(models.markOutboxProcesado).toHaveBeenCalledWith('outbox-good');
    });

    it('returns zeros without throwing when the DB read fails', async () => {
      vi.mocked(models.getOutboxPendientes).mockRejectedValue(new Error('db down'));

      const result = await processSheetsOutbox();

      expect(result).toEqual({ procesados: 0, fallidos: 0 });
    });
  });
});
