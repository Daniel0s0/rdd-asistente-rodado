import type { CaseResults } from '../../services/api';

interface ResultadosTabProps {
  data: CaseResults;
  loading: boolean;
}

export default function ResultadosTab({ data, loading }: ResultadosTabProps) {
  const getPercentage = (num: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((num / total) * 100);
  };

  if (loading) {
    return <div className="bg-gray-200 animate-pulse rounded-lg h-96" />;
  }

  const resultados = [
    {
      label: 'Con Resultado',
      value: data.conResultado,
      percentage: getPercentage(data.conResultado, data.total),
      color: 'bg-green-100 text-green-800',
      borderColor: 'border-green-300',
    },
    {
      label: 'Sin Resultado',
      value: data.sinResultado,
      percentage: getPercentage(data.sinResultado, data.total),
      color: 'bg-gray-100 text-gray-800',
      borderColor: 'border-gray-300',
    },
    {
      label: 'Desistidas',
      value: data.desistidas,
      percentage: getPercentage(data.desistidas, data.total),
      color: 'bg-orange-100 text-orange-800',
      borderColor: 'border-orange-300',
    },
    {
      label: 'Caducadas',
      value: data.caducadas,
      percentage: getPercentage(data.caducadas, data.total),
      color: 'bg-red-100 text-red-800',
      borderColor: 'border-red-300',
    },
    {
      label: 'Activas',
      value: data.activas,
      percentage: getPercentage(data.activas, data.total),
      color: 'bg-blue-100 text-blue-800',
      borderColor: 'border-blue-300',
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Total de Causas</h3>
        <p className="text-4xl font-bold text-gray-900">{data.total}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {resultados.map((item) => (
          <div
            key={item.label}
            className={`rounded-lg border-2 p-4 ${item.borderColor}`}
          >
            <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${item.color} mb-2`}>
              {item.percentage}%
            </div>
            <p className="text-gray-600 text-sm font-medium">{item.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Chart de distribución */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Distribución</h3>
        <div className="space-y-3">
          {resultados.map((item) => (
            <div key={item.label}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
                <span className="text-sm font-semibold text-gray-900">{item.value}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: item.color.split(' ')[0].replace('bg-', '').replace('-100', '-500'),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
