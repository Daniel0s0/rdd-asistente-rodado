export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const API_KEY = import.meta.env.VITE_API_KEY || '';

export interface CasesResponse {
  success: boolean;
  data?: {
    cases: Array<{
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
    }>;
    total: number;
  };
  timestamp: string;
  error?: string;
}

export interface AgentChatResponse {
  success: boolean;
  data?: {
    conversationId: string;
    messageId: string;
    assistantMessage: string;
    intent: string;
    extractedData?: Record<string, unknown>;
    flags?: Record<string, unknown>;
    shouldSyncSheets: boolean;
    sheetsSyncData?: Record<string, unknown>;
  };
  timestamp: string;
  error?: string;
}

export async function getCases(queryString?: string): Promise<CasesResponse> {
  const url = `${API_URL}/cases${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function sendMessage(
  causaId: string,
  message: string
): Promise<AgentChatResponse> {
  const url = `${API_URL}/agent/chat`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        causa_id: causaId,
        message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
