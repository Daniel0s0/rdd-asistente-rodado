import { useState, useRef, useEffect } from 'react';
import { getSocket, connectSocket, disconnectSocket } from '../services/socket';
import { API_KEY } from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatWindowProps {
  causaId: string;
  onBack: () => void;
}

export default function ChatWindow({ causaId, onBack }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const sock = getSocket();
    connectSocket();
    sock.emit('join_case', { causaId, apiKey: API_KEY });

    sock.on('joined', (_p) => {
      // room confirmed
    });

    sock.on('message_token', ({ token }) => {
      setStreamingContent((prev) => prev + token);
      setIsStreaming(true);
    });

    sock.on('message_complete', (payload) => {
      setIsStreaming(false);
      setStreamingContent('');
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: payload.assistantMessage,
        timestamp: payload.timestamp,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setLoading(false);
    });

    sock.on('error', (payload) => {
      setError(`Error: ${payload.message}`);
      setLoading(false);
      setIsStreaming(false);
      setStreamingContent('');
    });

    return () => {
      sock.emit('leave_case', { causaId });
      sock.off('joined');
      sock.off('message_token');
      sock.off('message_complete');
      sock.off('error');
      disconnectSocket();
    };
  }, [causaId]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError('');
    setLoading(true);

    getSocket().emit('send_message', { causaId, message: userMessage.content });
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Chat RDD</h2>
          <p className="text-sm text-gray-500">Causa: {causaId}</p>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
        >
          Volver
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-8">
            <p>Inicia una conversación formulando una pregunta sobre la causa</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
              }`}
            >
              <p className="break-words">{msg.content}</p>
              <p
                className={`text-xs mt-1 ${
                  msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                }`}
              >
                {new Date(msg.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg rounded-bl-none max-w-xs lg:max-w-md">
              <p className="break-words">{streamingContent}</p>
              <span className="inline-block w-1 h-4 bg-gray-400 animate-pulse ml-1" />
            </div>
          </div>
        )}

        {loading && !isStreaming && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg rounded-bl-none">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Escribe tu pregunta..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded-lg transition-colors"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
