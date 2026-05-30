import { useState } from 'react';
import Dashboard from './components/Dashboard';
import ChatWindow from './components/ChatWindow';

function App() {
  const [selectedCausaId, setSelectedCausaId] = useState<string | null>(null);

  if (!selectedCausaId) {
    return <Dashboard onSelectCausa={setSelectedCausaId} />;
  }

  return (
    <ChatWindow
      causaId={selectedCausaId}
      onBack={() => setSelectedCausaId(null)}
    />
  );
}

export default App;
