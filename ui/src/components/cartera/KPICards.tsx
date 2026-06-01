import type { CarteraKPI } from '../../services/api';

interface KPICardsProps {
  data: CarteraKPI;
  loading: boolean;
}

export default function KPICards({ data, loading }: KPICardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-gray-200 animate-pulse rounded-lg h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
      {/* Cobrado este año */}
      <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
        <p className="text-gray-600 text-sm font-medium">Cobrado este año</p>
        <p className="text-2xl font-bold text-blue-600 mt-1">
          {formatCurrency(data.totalCobradoAnio)}
        </p>
      </div>

      {/* Cobrado este mes */}
      <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
        <p className="text-gray-600 text-sm font-medium">Este mes</p>
        <p className="text-2xl font-bold text-green-600 mt-1">
          {formatCurrency(data.cobradoEsteMes)}
        </p>
      </div>

      {/* Acuerdos activos */}
      <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
        <p className="text-gray-600 text-sm font-medium">Acuerdos activos</p>
        <p className="text-2xl font-bold text-purple-600 mt-1">{data.acuerdosActivos}</p>
      </div>

      {/* Cuotas vencidas */}
      <div
        className={`bg-white rounded-lg shadow p-4 border-l-4 ${
          data.cuotasVencidas > 0 ? 'border-red-500' : 'border-gray-400'
        }`}
      >
        <p className="text-gray-600 text-sm font-medium">Cuotas vencidas</p>
        <p
          className={`text-2xl font-bold mt-1 ${
            data.cuotasVencidas > 0 ? 'text-red-600' : 'text-gray-600'
          }`}
        >
          {data.cuotasVencidas}
        </p>
      </div>

      {/* % Resultados */}
      <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
        <p className="text-gray-600 text-sm font-medium">% Resultados</p>
        <p className="text-2xl font-bold text-orange-600 mt-1">{data.porcentajeResultados}%</p>
      </div>

      {/* Causas pagadas */}
      <div className="bg-white rounded-lg shadow p-4 border-l-4 border-yellow-500">
        <p className="text-gray-600 text-sm font-medium">Causas pagadas</p>
        <p className="text-2xl font-bold text-yellow-600 mt-1">{data.causasPagadas}</p>
      </div>
    </div>
  );
}
