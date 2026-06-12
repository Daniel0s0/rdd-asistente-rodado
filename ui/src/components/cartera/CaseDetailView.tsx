import { useEffect, useState } from 'react';
import type { CaseDetail, RegistroRecord } from '../../services/api';
import { getCaseDetail } from '../../services/api';
import AddRegistroModal from './AddRegistroModal';

interface CaseDetailViewProps {
  causaId: string;
  onClose: () => void;
}

export default function CaseDetailView({ causaId, onClose }: CaseDetailViewProps) {
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadCaseDetail();
  }, [causaId]);

  const loadCaseDetail = async () => {
    setLoading(true);
    setError(null);
    const response = await getCaseDetail(causaId);
    if (response.success && response.data) {
      setCaseData(response.data);
    } else {
      setError(response.error || 'Error loading case details');
    }
    setLoading(false);
  };

  const handleAddRegistroSuccess = () => {
    loadCaseDetail();
    setShowAddModal(false);
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Cargando...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">{error}</p>
        <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-200 rounded">
          Volver
        </button>
      </div>
    );
  }

  if (!caseData) {
    return <div className="text-center py-8 text-gray-500">No se encontró la causa</div>;
  }

  const { conversation, registros, acuerdos, totales } = caseData;

  // Contrato Fase 9.1: case_state es activa|cerrada (el motivo va en motivo_cierre)
  const getStateBadgeColor = (state: string) => {
    const colors: Record<string, string> = {
      activa: 'bg-blue-100 text-blue-800',
      cerrada: 'bg-gray-100 text-gray-800',
    };
    return colors[state] || colors.activa;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{conversation.cliente_nombre}</h2>
          <div className="flex gap-3 mt-2 text-sm text-gray-600">
            {conversation.rit && <span>RIT: {conversation.rit}</span>}
            {conversation.tribunal && <span>Tribunal: {conversation.tribunal}</span>}
            <span
              className={`px-3 py-1 rounded-full font-semibold ${getStateBadgeColor(conversation.case_state)}`}
            >
              {conversation.case_state}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
        >
          ← Volver
        </button>
      </div>

      {/* Totales - 4 tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-gray-600 text-sm font-medium">Cobranza Total</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            ${totales.totalCobranza.toLocaleString('es-CL')}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <p className="text-gray-600 text-sm font-medium">Honorarios</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            ${totales.totalHonorarios.toLocaleString('es-CL')}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
          <p className="text-gray-600 text-sm font-medium">Gastos</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            ${totales.totalGastos.toLocaleString('es-CL')}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <p className="text-gray-600 text-sm font-medium">Sentencias</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">
            ${totales.totalSentencias.toLocaleString('es-CL')}
          </p>
        </div>
      </div>

      {/* Registros */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Registros Financieros</h3>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
          >
            + Agregar Registro
          </button>
        </div>

        {registros.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-6 text-center text-gray-500">
            No hay registros financieros
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Fecha</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Tipo</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Monto</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {registros.map((reg: RegistroRecord) => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm text-gray-700">
                      {new Date(reg.fecha).toLocaleDateString('es-CL')}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold
                        ${reg.tipo === 'cobranza' ? 'bg-blue-100 text-blue-800' : ''}
                        ${reg.tipo === 'honorarios' ? 'bg-green-100 text-green-800' : ''}
                        ${reg.tipo === 'gasto' ? 'bg-orange-100 text-orange-800' : ''}
                        ${reg.tipo === 'sentencia' ? 'bg-purple-100 text-purple-800' : ''}
                      `}>
                        {reg.tipo}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                      ${reg.monto.toLocaleString('es-CL')}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600">{reg.notas || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Acuerdos */}
      {acuerdos.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Acuerdos de Pago</h3>
          <div className="space-y-4">
            {acuerdos.map((acuerdo) => (
              <div key={acuerdo.id} className="bg-white rounded-lg shadow p-4">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Monto Total</p>
                    <p className="text-lg font-bold text-gray-900">
                      ${acuerdo.monto_total.toLocaleString('es-CL')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Cuotas</p>
                    <p className="text-lg font-bold text-gray-900">
                      {acuerdo.cuotas.filter((c) => c.fecha_pago).length} / {acuerdo.cuotas_total}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Estado</p>
                    <p className={`text-lg font-bold ${acuerdo.estado === 'activo' ? 'text-blue-600' : 'text-gray-600'}`}>
                      {acuerdo.estado}
                    </p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-600">
                        <th className="text-left">Cuota</th>
                        <th className="text-right">Monto</th>
                        <th className="text-left">Vencimiento</th>
                        <th className="text-left">Pagado</th>
                        <th className="text-left">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {acuerdo.cuotas.map((cuota, idx) => (
                        <tr key={idx} className="text-gray-700">
                          <td>#{cuota.numero}</td>
                          <td className="text-right">${cuota.monto.toLocaleString('es-CL')}</td>
                          <td>{cuota.fecha_vencimiento ? new Date(cuota.fecha_vencimiento).toLocaleDateString('es-CL') : '-'}</td>
                          <td>{cuota.fecha_pago ? new Date(cuota.fecha_pago).toLocaleDateString('es-CL') : '-'}</td>
                          <td>
                            <span className={`px-2 py-1 rounded text-xs font-semibold
                              ${cuota.estado === 'pagada' ? 'bg-green-100 text-green-800' : ''}
                              ${cuota.estado === 'pendiente' ? 'bg-yellow-100 text-yellow-800' : ''}
                              ${cuota.estado === 'vencida' ? 'bg-red-100 text-red-800' : ''}
                            `}>
                              {cuota.estado}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {showAddModal && (
        <AddRegistroModal
          conversationId={conversation.id}
          onSuccess={handleAddRegistroSuccess}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
