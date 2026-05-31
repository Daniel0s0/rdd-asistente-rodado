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

// Analytics API types & functions
export interface CarteraKPI {
  totalCobradoAnio: number;
  cobradoEsteMes: number;
  acuerdosActivos: number;
  cuotasVencidas: number;
  porcentajeResultados: number;
  causasActivas: number;
  causasDesistidas: number;
  causasCaducadas: number;
}

export interface IncomeData {
  porMes: Array<{
    mes: string;
    total: number;
    cobranza: number;
    sentencia: number;
    acuerdo: number;
  }>;
  porFuente: {
    cobranza: number;
    sentencia: number;
    acuerdo: number;
  };
}

export interface AcuerdoStatus {
  causaId: string;
  acuerdoId: string;
  montoTotal: number;
  cuotasPagadas: number;
  cuotasTotal: number;
  proximoVencimiento: string;
  cuotasVencidas: number;
  estadoGeneral: string;
}

export interface CaseResults {
  total: number;
  conResultado: number;
  sinResultado: number;
  desistidas: number;
  caducadas: number;
  activas: number;
}

export interface AnalyticsResponse<T> {
  success: boolean;
  data?: T;
  timestamp: string;
  error?: string;
}

export async function getCartera(): Promise<AnalyticsResponse<CarteraKPI>> {
  const url = `${API_URL}/analytics/cartera`;

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

export async function getIngresos(
  from?: string,
  to?: string
): Promise<AnalyticsResponse<IncomeData>> {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const url = `${API_URL}/analytics/ingresos${params.toString() ? '?' + params.toString() : ''}`;

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

export async function getAcuerdos(): Promise<AnalyticsResponse<AcuerdoStatus[]>> {
  const url = `${API_URL}/analytics/acuerdos`;

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

export async function getResultados(): Promise<AnalyticsResponse<CaseResults>> {
  const url = `${API_URL}/analytics/resultados`;

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

// Portfolio Chat (Phase 6.5)
export interface PortfolioChatResponse {
  success: boolean;
  data?: {
    conversationId: string;
    messageId: string;
    assistantMessage: string;
  };
  timestamp: string;
  error?: string;
}

export async function portfolioChat(
  message: string,
  conversationId?: string
): Promise<PortfolioChatResponse> {
  const url = `${API_URL}/agent/portfolio-chat`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
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
    const message_err = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message_err,
      timestamp: new Date().toISOString(),
    };
  }
}
