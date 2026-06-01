import { useState, useEffect } from 'react';
import { getCartera, getIngresos, getAcuerdos, getResultados } from '../services/api';
import type { CarteraKPI, IncomeData, AcuerdoStatus, CaseResults } from '../services/api';
import KPICards from './cartera/KPICards';
import IngresosTab from './cartera/IngresosTab';
import AcuerdosTab from './cartera/AcuerdosTab';
import ResultadosTab from './cartera/ResultadosTab';
import CaseDetailView from './cartera/CaseDetailView';

type TabType = 'ingresos' | 'acuerdos' | 'resultados';

interface CarteraProps {
  onOpenChat: () => void;
}

export default function Cartera({ onOpenChat }: CarteraProps) {
  const [activeTab, setActiveTab] = useState<TabType>('ingresos');
  const [kpiData, setKpiData] = useState<CarteraKPI | null>(null);
  const [incomeData, setIncomeData] = useState<IncomeData | null>(null);
  const [acuerdosData, setAcuerdosData] = useState<AcuerdoStatus[] | null>(null);
  const [resultadosData, setResultadosData] = useState<CaseResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCausaId, setSelectedCausaId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [kpiRes, incomeRes, acuerdosRes, resultadosRes] = await Promise.all([
        getCartera(),
        getIngresos(),
        getAcuerdos(),
        getResultados(),
      ]);

      if (!kpiRes.success || !kpiRes.data) {
        throw new Error(kpiRes.error || 'Error al cargar KPIs');
      }
      setKpiData(kpiRes.data);

      if (!incomeRes.success || !incomeRes.data) {
        throw new Error(incomeRes.error || 'Error al cargar ingresos');
      }
      setIncomeData(incomeRes.data);

      if (!acuerdosRes.success || !acuerdosRes.data) {
        throw new Error(acuerdosRes.error || 'Error al cargar acuerdos');
      }
      setAcuerdosData(acuerdosRes.data);

      if (!resultadosRes.success || !resultadosRes.data) {
        throw new Error(resultadosRes.error || 'Error al cargar resultados');
      }
      setResultadosData(resultadosRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cartera</h1>
            <p className="text-gray-600 mt-1">Análisis de ingresos y acuerdos</p>
          </div>
          <button
            onClick={onOpenChat}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Consultar a Rodado
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
            <button
              onClick={loadData}
              className="mt-2 text-red-600 hover:text-red-800 font-medium text-sm"
            >
              Intentar de nuevo
            </button>
          </div>
        )}

        {/* Case Detail View */}
        {selectedCausaId && (
          <div className="bg-white rounded-lg shadow p-6">
            <CaseDetailView causaId={selectedCausaId} onClose={() => setSelectedCausaId(null)} />
          </div>
        )}

        {/* KPI Cards and Tabs */}
        {!selectedCausaId && (
          <>
            {/* KPI Cards */}
            {kpiData && <KPICards data={kpiData} loading={loading} />}

            {/* Tabs */}
            <div className="bg-white rounded-lg shadow">
              {/* Tab buttons */}
              <div className="border-b border-gray-200">
                <div className="flex">
                  {(['ingresos', 'acuerdos', 'resultados'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-6 py-4 font-medium text-sm transition-colors ${
                        activeTab === tab
                          ? 'text-blue-600 border-b-2 border-blue-600'
                          : 'text-gray-700 hover:text-gray-900'
                      }`}
                    >
                      {tab === 'ingresos' && 'Ingresos'}
                      {tab === 'acuerdos' && 'Acuerdos'}
                      {tab === 'resultados' && 'Resultados'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="p-6">
                {activeTab === 'ingresos' && incomeData && (
                  <IngresosTab data={incomeData} loading={loading} />
                )}
                {activeTab === 'acuerdos' && acuerdosData && (
                  <AcuerdosTab data={acuerdosData} loading={loading} onSelectCausa={setSelectedCausaId} />
                )}
                {activeTab === 'resultados' && resultadosData && (
                  <ResultadosTab data={resultadosData} loading={loading} />
                )}
              </div>
            </div>
          </>
        )}

        {/* Refresh button */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
