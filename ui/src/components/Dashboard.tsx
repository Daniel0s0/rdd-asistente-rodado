import { useState, useEffect, useRef } from 'react';
import { getCases } from '../services/api';
import type { CasesResponse } from '../services/api';

interface Case {
  causaId: string;
  status: 'active' | 'closed';
  createdAt: string;
  clienteNombre?: string;
  demandado?: string;
  tribunal?: string;
  rit?: string;
  etapa?: string;
  caseState?: string;
  ingresoHonorarios?: number;
  pagosPendientes?: number;
}

interface DashboardProps {
  onSelectCausa: (causaId: string) => void;
}

export default function Dashboard({ onSelectCausa }: DashboardProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [causaId, setCausaId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTribunal, setFilterTribunal] = useState('');
  const [filterEtapa, setFilterEtapa] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadCases = async (q?: string, tribunal?: string, etapa?: string, caseState?: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (tribunal) params.append('tribunal', tribunal);
      if (etapa) params.append('etapa', etapa);
      if (caseState) params.append('case_state', caseState);

      const response: CasesResponse = await getCases(params.toString());
      if (response.success && response.data) {
        setCases(response.data.cases);
      } else {
        setError(response.error || 'Error al cargar causas');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      loadCases(value || undefined, filterTribunal || undefined, filterEtapa || undefined, filterStatus || undefined);
    }, 300);
  };

  const handleFilterChange = (tribunal?: string, etapa?: string, status?: string) => {
    setFilterTribunal(tribunal || '');
    setFilterEtapa(etapa || '');
    setFilterStatus(status || '');
    loadCases(searchQuery || undefined, tribunal || undefined, etapa || undefined, status || undefined);
  };

  const handleSelectCase = (causaId: string) => {
    onSelectCausa(causaId);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!causaId.trim()) {
      setError('Por favor ingresa un ID de causa');
      return;
    }
    setError('');
    onSelectCausa(causaId.trim());
  };

  const uniqueTribunals = Array.from(new Set(cases.map((c) => c.tribunal).filter(Boolean))) as string[];

  const CASE_STATES = [
    { value: 'activo', label: 'Activo' },
    { value: 'acuerdo', label: 'Acuerdo' },
    { value: 'archivado', label: 'Archivado' },
    { value: 'desistido', label: 'Desistido' },
    { value: 'caducado', label: 'Caducado' },
  ];

  const getCaseStateStyle = (state: string | undefined) => {
    const styles: Record<string, { bg: string; text: string; label: string }> = {
      activo: { bg: 'bg-green-100', text: 'text-green-800', label: 'Activo' },
      acuerdo: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Acuerdo' },
      archivado: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Archivado' },
      desistido: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Desistido' },
      caducado: { bg: 'bg-red-100', text: 'text-red-800', label: 'Caducado' },
    };
    return state && state in styles ? styles[state] : { bg: 'bg-gray-100', text: 'text-gray-600', label: state || 'Desconocido' };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">RDD Asistente</h1>
        <p className="text-gray-600 mb-8">Sistema de análisis de casos jurídicos</p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {loading && cases.length === 0 ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : cases.length === 0 && !showManualInput ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-6">No hay causas registradas</p>
            <button
              onClick={() => setShowManualInput(true)}
              className="text-blue-600 hover:text-blue-700 font-semibold underline"
            >
              Ingresar ID manualmente
            </button>
          </div>
        ) : (
          <div>
            {/* Search Bar */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Buscar por cliente, demandado, tribunal, RIT o causa_id..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <select
                value={filterTribunal}
                onChange={(e) => handleFilterChange(e.target.value, filterEtapa, filterStatus)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todos los tribunales</option>
                {uniqueTribunals.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <select
                value={filterEtapa}
                onChange={(e) => handleFilterChange(filterTribunal, e.target.value, filterStatus)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todas las etapas</option>
                <option value="litigacion">Litigación</option>
                <option value="cobranza">Cobranza</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => handleFilterChange(filterTribunal, filterEtapa, e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todos los estados</option>
                {CASE_STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Cases List */}
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              Causas ({cases.length})
            </h2>
            <div className="space-y-3 mb-6 max-h-96 overflow-y-auto">
              {cases.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No se encontraron causas con los filtros aplicados</p>
              ) : (
                cases.map((c) => (
                  <button
                    key={c.causaId}
                    onClick={() => handleSelectCase(c.causaId)}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-gray-800">{c.causaId}</p>
                        {c.clienteNombre && (
                          <p className="text-sm text-gray-600">Cliente: {c.clienteNombre}</p>
                        )}
                        {c.demandado && (
                          <p className="text-sm text-gray-600">Demandado: {c.demandado}</p>
                        )}
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          {c.tribunal && <span>{c.tribunal}</span>}
                          {c.rit && <span>RIT: {c.rit}</span>}
                          {c.etapa && <span>{c.etapa}</span>}
                          <span>{new Date(c.createdAt).toLocaleDateString('es-CL')}</span>
                        </div>
                        {c.ingresoHonorarios !== undefined && (
                          <div className="flex gap-4 mt-1 text-xs font-medium">
                            <span className="text-green-600">Ingreso: ${c.ingresoHonorarios.toLocaleString()}</span>
                            {c.pagosPendientes !== undefined && c.pagosPendientes > 0 && (
                              <span className="text-red-600">Pendiente: ${c.pagosPendientes.toLocaleString()}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                            c.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {c.status === 'active' ? 'Activa' : 'Cerrada'}
                        </span>
                        {c.caseState && (() => {
                          const style = getCaseStateStyle(c.caseState);
                          return (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
                              {style.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t pt-6">
              <button
                onClick={() => setShowManualInput(!showManualInput)}
                className="text-blue-600 hover:text-blue-700 font-semibold text-sm"
              >
                {showManualInput ? 'Cancelar entrada manual' : 'O ingresa un ID manualmente'}
              </button>
            </div>
          </div>
        )}

        {(showManualInput || cases.length === 0) && !loading && (
          <form onSubmit={handleManualSubmit} className="mt-8">
            <div className="mb-4">
              <label htmlFor="causaId" className="block text-sm font-medium text-gray-700 mb-2">
                ID de Causa
              </label>
              <input
                id="causaId"
                type="text"
                value={causaId}
                onChange={(e) => {
                  setCausaId(e.target.value);
                  setError('');
                }}
                placeholder="Ej: 2024-00123"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg transition-colors"
            >
              Ingresar al Chat
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
