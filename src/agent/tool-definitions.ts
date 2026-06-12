// src/agent/tool-definitions.ts

/**
 * Tool definitions for RDD Agent (Phase 8.1).
 * Maps financial actions Claude can perform to their JSON schemas.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

// 1. create_registro — Registro de cobranza, sentencia, o gasto
export const createRegistroTool: ToolDefinition = {
  name: 'create_registro',
  description: 'Registra un ingreso (cobranza, sentencia o gasto) en la causa. Úsalo cuando el usuario menciona dinero que llegó o gastó sin una estructura de cuotas.',
  input_schema: {
    type: 'object',
    properties: {
      tipo: {
        type: 'string',
        enum: ['cobranza', 'sentencia', 'gasto'],
        description: 'Tipo de registro: cobranza (dinero recibido), sentencia (resolución judicial), gasto (costo incurrido)',
      },
      monto: {
        type: 'number',
        description: 'Monto en CLP. Debe ser > 0.',
      },
      fecha: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Fecha del registro (YYYY-MM-DD). Debe ser hoy o anterior.',
      },
      descripcion: {
        type: 'string',
        description: 'Descripción breve (opcional). Máx 200 caracteres.',
      },
    },
    required: ['tipo', 'monto', 'fecha'],
  },
};

// 2. create_acuerdo — Acuerdo con estructura de cuotas
export const createAcuerdoTool: ToolDefinition = {
  name: 'create_acuerdo',
  description: 'Registra un acuerdo (arreglo pactado) con montos, cuotas y fechas de pago. Úsalo cuando el usuario menciona "acuerdo", "pactaron", "arreglo", etc. con cuotas.',
  input_schema: {
    type: 'object',
    properties: {
      montoTotal: {
        type: 'number',
        description: 'Monto total del acuerdo en CLP. Debe ser > 0.',
      },
      cuotasTotal: {
        type: 'number',
        description: 'Número total de cuotas. Debe ser entero > 0.',
      },
      fechaPrimerPago: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Fecha de la primera cuota (YYYY-MM-DD).',
      },
      porcentajeHonorarios: {
        type: 'number',
        description: 'Porcentaje de honorarios (0–100). Opcional, default 0.',
      },
      descripcion: {
        type: 'string',
        description: 'Descripción del acuerdo (opcional). Máx 300 caracteres.',
      },
    },
    required: ['montoTotal', 'cuotasTotal', 'fechaPrimerPago'],
  },
};

// 3. mark_cuota_pagada — Marcar una cuota como pagada
export const markCuotaPagadaTool: ToolDefinition = {
  name: 'mark_cuota_pagada',
  description: 'Marca una cuota específica de un acuerdo como pagada. Úsalo cuando el usuario confirma que pagó una de las cuotas pactadas.',
  input_schema: {
    type: 'object',
    properties: {
      acuerdoId: {
        type: 'string',
        description: 'ID del acuerdo (proporcionado por el sistema después de create_acuerdo).',
      },
      numeroCuota: {
        type: 'number',
        description: 'Número de cuota (1, 2, 3, etc.).',
      },
      fecha: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Fecha en que se pagó (YYYY-MM-DD).',
      },
    },
    required: ['acuerdoId', 'numeroCuota', 'fecha'],
  },
};

// 4. get_caso_estado — Consultar estado del caso
export const getCasoEstadoTool: ToolDefinition = {
  name: 'get_caso_estado',
  description: 'Consulta el estado actual de la causa: acuerdos activos, cuotas vencidas, montos cobrados, próximas acciones.',
  input_schema: {
    type: 'object',
    properties: {
      incluirHistorial: {
        type: 'boolean',
        description: 'Si true, incluye histórico de pagos (opcional, default false).',
      },
    },
    required: [],
  },
};

// 5. close_case — Cerrar la causa
export const closeCapeTool: ToolDefinition = {
  name: 'close_case',
  description: 'Cierra la causa marcándola como finalizada. Úsalo solo cuando el usuario confirma que la causa terminó completamente.',
  input_schema: {
    type: 'object',
    properties: {
      motivo_cierre: {
        type: 'string',
        enum: ['pago_total', 'desistimiento', 'caducada'],
        description: 'Razón del cierre: pago_total (se cobró todo), desistimiento (cliente retiró demanda), caducada (no se tramitó)',
      },
      notas: {
        type: 'string',
        description: 'Notas adicionales sobre el cierre (opcional).',
      },
    },
    required: ['motivo_cierre'],
  },
};

/**
 * Array of all tools for Claude SDK.
 * Pass this to client.messages.create({ tools: AGENT_TOOLS })
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  createRegistroTool,
  createAcuerdoTool,
  markCuotaPagadaTool,
  getCasoEstadoTool,
  closeCapeTool,
];
