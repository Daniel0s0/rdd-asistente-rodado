import { useState } from 'react';
import Dashboard from './components/Dashboard';
import ChatWindow from './components/ChatWindow';
import Cartera from './components/Cartera';

type AppView = 'causas' | 'cartera' | 'chat';

function App() {
  const [view, setView] = useState<AppView>('causas');
  const [selectedCausaId, setSelectedCausaId] = useState<string | null>(null);

  const handleSelectCausa = (causaId: string) => {
    setSelectedCausaId(causaId);
    setView('chat');
  };

  const handleBack = () => {
    setSelectedCausaId(null);
    setView('causas');
  };

  if (view === 'chat' && selectedCausaId) {
    return <ChatWindow causaId={selectedCausaId} onBack={handleBack} />;
  }

  return (
    <div>
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex h-16 items-center space-x-8">
            <button
              onClick={() => setView('causas')}
              className={`font-medium text-sm transition-colors h-16 flex items-center border-b-2 ${
                view === 'causas'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              Causas
            </button>
            <button
              onClick={() => setView('cartera')}
              className={`font-medium text-sm transition-colors h-16 flex items-center border-b-2 ${
                view === 'cartera'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              Cartera
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {view === 'causas' && <Dashboard onSelectCausa={handleSelectCausa} />}
      {view === 'cartera' && <Cartera />}
    </div>
  );
}

export default App;
