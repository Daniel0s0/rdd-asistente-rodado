import type { AcuerdoStatus } from '../../services/api';

interface AcuerdosTabProps {
  data: AcuerdoStatus[];
  loading: boolean;
}

export default function AcuerdosTab({ data, loading }: AcuerdosTabProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getEstadoBadge = (estado: string) => {
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      al_dia: { bg: 'bg-green-100', text: 'text-green-800', label: 'Al día' },
      con_retraso: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Con retraso' },
      vencido: { bg: 'bg-red-100', text: 'text-red-800', label: 'Vencido' },
      completado: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Completado' },
    };
    const badge = badges[estado] || { bg: 'bg-gray-100', text: 'text-gray-800', label: estado };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  if (loading) {
    return <div className="bg-gray-200 animate-pulse rounded-lg h-96" />;
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <p className="text-gray-600">No hay acuerdos registrados</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Causa
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Monto Total
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Cuotas
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Próx. Vencimiento
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Vencidas
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((acuerdo) => (
              <tr key={acuerdo.acuerdoId} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{acuerdo.causaId}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{formatCurrency(acuerdo.montoTotal)}</td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {acuerdo.cuotasPagadas}/{acuerdo.cuotasTotal}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{acuerdo.proximoVencimiento}</td>
                <td className="px-6 py-4 text-sm">
                  {acuerdo.cuotasVencidas > 0 ? (
                    <span className="text-red-600 font-semibold">{acuerdo.cuotasVencidas}</span>
                  ) : (
                    <span className="text-gray-600">0</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">{getEstadoBadge(acuerdo.estadoGeneral)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
