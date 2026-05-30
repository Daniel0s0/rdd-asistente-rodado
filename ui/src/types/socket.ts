export interface SocketJoinCasePayload {
  causaId: string;
  apiKey: string;
}

export interface SocketSendMessagePayload {
  causaId: string;
  message: string;
}

export interface SocketLeaveCasePayload {
  causaId: string;
}

export interface SocketJoinedPayload {
  causaId: string;
}

export interface SocketMessageTokenPayload {
  token: string;
}

export interface SocketMessageCompletePayload {
  causaId: string;
  assistantMessage: string;
  intent: string;
  shouldSyncSheets: boolean;
  timestamp: string;
}

export interface SocketErrorPayload {
  code: 'auth_failed' | 'not_in_room' | 'validation_error' | 'stream_error' | 'internal_error';
  message: string;
}

export interface ServerToClientEvents {
  joined: (payload: SocketJoinedPayload) => void;
  message_token: (payload: SocketMessageTokenPayload) => void;
  message_complete: (payload: SocketMessageCompletePayload) => void;
  error: (payload: SocketErrorPayload) => void;
}

export interface ClientToServerEvents {
  join_case: (payload: SocketJoinCasePayload) => void;
  send_message: (payload: SocketSendMessagePayload) => void;
  leave_case: (payload: SocketLeaveCasePayload) => void;
}
