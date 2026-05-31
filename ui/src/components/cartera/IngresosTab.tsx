import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { IncomeData } from '../../services/api';

interface IngresosTabProps {
  data: IncomeData;
  loading: boolean;
}

export default function IngresosTab({ data, loading }: IngresosTabProps) {
  const formatCurrency = (amount: number) => {
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(1)}M`;
    }
    if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(0)}K`;
    }
    return `$${amount}`;
  };

  const chartData = useMemo(() => {
    return data.porMes.map((mes) => ({
      mes: mes.mes,
      cobranza: mes.cobranza,
      sentencia: mes.sentencia,
      acuerdo: mes.acuerdo,
    }));
  }, [data.porMes]);

  const sourceData = useMemo(
    () => [
      {
        name: 'Cobranza',
        value: data.porFuente.cobranza,
        color: '#10b981',
      },
      {
        name: 'Sentencia',
        value: data.porFuente.sentencia,
        color: '#3b82f6',
      },
      {
        name: 'Acuerdo',
        value: data.porFuente.acuerdo,
        color: '#8b5cf6',
      },
    ],
    [data.porFuente]
  );

  if (loading) {
    return <div className="bg-gray-200 animate-pulse rounded-lg h-96" />;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Gráfico de barras apiladas por mes */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Ingresos por mes</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" />
            <YAxis tickFormatter={formatCurrency} />
            <Tooltip
              formatter={(value: any) => formatCurrency(value as number)}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <Legend />
            <Bar dataKey="cobranza" stackId="a" fill="#10b981" name="Cobranza" />
            <Bar dataKey="sentencia" stackId="a" fill="#3b82f6" name="Sentencia" />
            <Bar dataKey="acuerdo" stackId="a" fill="#8b5cf6" name="Acuerdo" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown por fuente */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Ingresos por fuente</h3>
        <div className="space-y-4">
          {sourceData.map((source) => (
            <div key={source.name}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-700">{source.name}</span>
                <span className="text-sm font-semibold text-gray-900">{source.value}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${source.value}%`,
                    backgroundColor: source.color,
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
