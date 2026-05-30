import { useState, useEffect } from 'react';
import { getCases } from '../services/api';
import type { CasesResponse } from '../services/api';

interface Case {
  causaId: string;
  status: 'active' | 'closed';
  createdAt: string;
  metadata: Record<string, unknown>;
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

  useEffect(() => {
    const loadCases = async () => {
      try {
        const response: CasesResponse = await getCases();
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

    loadCases();
  }, []);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">RDD Asistente</h1>
        <p className="text-gray-600 mb-8">Sistema de análisis de casos</p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : cases.length === 0 ? (
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
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Selecciona una causa:</h2>
            <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
              {cases.map((c) => (
                <button
                  key={c.causaId}
                  onClick={() => handleSelectCase(c.causaId)}
                  className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{c.causaId}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(c.createdAt).toLocaleDateString('es-CL')}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        c.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {c.status === 'active' ? 'Activa' : 'Cerrada'}
                    </span>
                  </div>
                </button>
              ))}
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
