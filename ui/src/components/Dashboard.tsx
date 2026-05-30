import { useState } from 'react';

interface DashboardProps {
  onSelectCausa: (causaId: string) => void;
}

export default function Dashboard({ onSelectCausa }: DashboardProps) {
  const [causaId, setCausaId] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
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
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">RDD Asistente</h1>
        <p className="text-gray-600 mb-8">Sistema de análisis de casos</p>

        <form onSubmit={handleSubmit}>
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

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg transition-colors"
          >
            Ingresar al Chat
          </button>
        </form>

        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <p className="text-sm text-gray-600">
            <span className="font-semibold">Tip:</span> Usa el ID de causa que registraste en el sistema
          </p>
        </div>
      </div>
    </div>
  );
}
