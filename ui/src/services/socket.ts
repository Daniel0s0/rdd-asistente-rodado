import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
type RDDSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: RDDSocket | null = null;

export function getSocket(): RDDSocket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function connectSocket(): void {
  getSocket().connect();
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
