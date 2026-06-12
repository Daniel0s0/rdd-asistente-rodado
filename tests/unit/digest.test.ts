import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@database/analytics-queries', () => ({
  getAcuerdosStatus: vi.fn(),
  getCasosConPendingAction: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { digestHandler } from '@api/digest';
import * as analytics from '@database/analytics-queries';

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function acuerdo(overrides: Partial<analytics.AcuerdoStatus> = {}): analytics.AcuerdoStatus {
  return {
    causaId: 'causa-001',
    acuerdoId: 'acuerdo-001',
    montoTotal: 500000,
    cuotasPagadas: 1,
    cuotasTotal: 5,
    proximoVencimiento: null,
    cuotasVencidas: 0,
    estadoGeneral: 'al_dia',
    ...overrides,
  };
}

function fechaEnDias(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

describe('digestHandler (GET /agent/digest)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports pending actions, overdue acuerdos and upcoming cuotas', async () => {
    vi.mocked(analytics.getCasosConPendingAction).mockResolvedValue([
      {
        causaId: 'causa-pend',
        clienteNombre: 'Cliente X',
        pendingAction: 'ask_acuerdo_terms',
        updatedAt: '2026-06-10T00:00:00Z',
      },
    ]);
    vi.mocked(analytics.getAcuerdosStatus).mockResolvedValue([
      acuerdo({ causaId: 'causa-vencida', cuotasVencidas: 2, estadoGeneral: 'vencido' }),
      acuerdo({ causaId: 'causa-proxima', proximoVencimiento: fechaEnDias(3) }),
      acuerdo({ causaId: 'causa-lejana', proximoVencimiento: fechaEnDias(30) }),
    ]);

    const res = createResponse() as any;
    await digestHandler({} as any, res);

    expect(res.json).toHaveBeenCalledOnce();
    const body = vi.mocked(res.json).mock.calls[0][0];

    expect(body.acciones_pendientes).toHaveLength(1);
    expect(body.acuerdos_vencidos.map((a: any) => a.causaId)).toEqual(['causa-vencida']);
    // Solo la cuota dentro de la ventana de 7 días, no la de 30
    expect(body.proximos_vencimientos.map((a: any) => a.causaId)).toEqual(['causa-proxima']);
    expect(body.resumen).toContain('causa-pend');
    expect(body.resumen).toContain('causa-vencida');
    expect(body.resumen).toContain('causa-proxima');
    expect(body.resumen).not.toContain('causa-lejana');
  });

  it('returns an "al día" summary when nothing is pending', async () => {
    vi.mocked(analytics.getCasosConPendingAction).mockResolvedValue([]);
    vi.mocked(analytics.getAcuerdosStatus).mockResolvedValue([acuerdo()]);

    const res = createResponse() as any;
    await digestHandler({} as any, res);

    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(body.acciones_pendientes).toEqual([]);
    expect(body.acuerdos_vencidos).toEqual([]);
    expect(body.proximos_vencimientos).toEqual([]);
    expect(body.resumen).toContain('Cartera al día');
  });

  it('does not list an overdue acuerdo also as upcoming', async () => {
    vi.mocked(analytics.getCasosConPendingAction).mockResolvedValue([]);
    vi.mocked(analytics.getAcuerdosStatus).mockResolvedValue([
      acuerdo({ causaId: 'causa-doble', cuotasVencidas: 1, proximoVencimiento: fechaEnDias(2) }),
    ]);

    const res = createResponse() as any;
    await digestHandler({} as any, res);

    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(body.acuerdos_vencidos).toHaveLength(1);
    expect(body.proximos_vencimientos).toHaveLength(0);
  });

  it('responds 500 with error shape when a query fails', async () => {
    vi.mocked(analytics.getCasosConPendingAction).mockRejectedValue(new Error('db down'));
    vi.mocked(analytics.getAcuerdosStatus).mockResolvedValue([]);

    const res = createResponse() as any;
    await digestHandler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'internal_error' })
    );
  });
});
