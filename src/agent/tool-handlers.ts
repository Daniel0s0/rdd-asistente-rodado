// src/agent/tool-handlers.ts

import { logger } from '@utils/logger';
import {
  createRegistro,
  createAcuerdo,
  createCuotas,
  markCuotaPagada,
  getAcuerdosActivos,
  getCuotasByAcuerdo,
  updateConversationMetadata,
} from '@database/models';
import { calculateCuotaDates } from './claude-agent';

/**
 * Result of a tool call.
 * Claude receives this and uses it to decide next steps.
 */
export interface ToolResult {
  tool_name: string;
  tool_use_id: string;
  content: string; // Text Claude reads to understand the result
  isError: boolean;
}

/**
 * Execute a tool call and return result.
 *
 * @param toolName  - Name of the tool (e.g., 'create_acuerdo')
 * @param toolUseId - ID of this tool use block (from Claude SDK)
 * @param input     - Input object from Claude (validated by schema)
 * @param conversationId - Context: which cause/conversation
 *
 * @returns ToolResult that will be sent back to Claude
 */
export async function executeTool(
  toolName: string,
  toolUseId: string,
  input: Record<string, unknown>,
  conversationId: string
): Promise<ToolResult> {
  logger.debug(
    { toolName, toolUseId, conversationId },
    'executeTool: starting'
  );

  try {
    let resultText: string;

    switch (toolName) {
      case 'create_registro': {
        const { tipo, monto, fecha } = input as {
          tipo: 'cobranza' | 'sentencia' | 'gasto';
          monto: number;
          fecha: string;
        };
        const registro = await createRegistro({
          conversationId,
          tipo,
          monto,
          fecha,
        });
        resultText = `✅ Registro creado: ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} de $${monto.toLocaleString('es-CL')} en ${fecha}. ID: ${registro.id}`;
        break;
      }

      case 'create_acuerdo': {
        const { montoTotal, cuotasTotal, fechaPrimerPago, porcentajeHonorarios } = input as {
          montoTotal: number;
          cuotasTotal: number;
          fechaPrimerPago: string;
          porcentajeHonorarios?: number;
        };

        // Validate inputs
        if (montoTotal <= 0 || cuotasTotal <= 0) {
          throw new Error('Monto y cuotas deben ser > 0');
        }
        if (porcentajeHonorarios && (porcentajeHonorarios < 0 || porcentajeHonorarios > 100)) {
          throw new Error('Porcentaje debe estar entre 0 y 100');
        }

        const montoPorCuota = montoTotal / cuotasTotal;
        const acuerdo = await createAcuerdo({
          conversationId,
          montoTotal,
          cuotasTotal,
          montoPorCuota,
          porcentajeHonorarios: porcentajeHonorarios ?? 0,
          fechaPrimerPago,
        });

        // Create cuotas
        const cuotaDates = calculateCuotaDates(fechaPrimerPago, cuotasTotal);
        const cuotasToCreate = cuotaDates.map((fecha, idx) => ({
          numero: idx + 1,
          monto: montoPorCuota,
          fechaVencimiento: fecha,
        }));
        await createCuotas(acuerdo.id, cuotasToCreate);

        resultText = `✅ Acuerdo creado: $${montoTotal.toLocaleString('es-CL')} en ${cuotasTotal} cuotas de $${montoPorCuota.toLocaleString('es-CL')}. Primer pago: ${fechaPrimerPago}. ID acuerdo: ${acuerdo.id}`;
        break;
      }

      case 'mark_cuota_pagada': {
        const { acuerdoId, numeroCuota, fecha } = input as {
          acuerdoId?: string;
          numeroCuota: number;
          fecha: string;
        };

        if (!acuerdoId) {
          throw new Error('acuerdoId es requerido');
        }

        await markCuotaPagada(acuerdoId, numeroCuota, fecha);
        resultText = `✅ Cuota #${numeroCuota} marcada como pagada en ${fecha}`;
        break;
      }

      case 'get_caso_estado': {
        // Fetch current case status
        const acuerdosActivos = await getAcuerdosActivos(conversationId);

        if (acuerdosActivos.length === 0) {
          resultText = 'ℹ️ No hay acuerdos activos en esta causa.';
        } else {
          const lineas: string[] = [];
          for (const acuerdo of acuerdosActivos) {
            const cuotas = await getCuotasByAcuerdo(acuerdo.id);
            const pagadas = cuotas.filter(
              (c) => c.estado === 'pagada' || c.estado === 'pagada_con_retraso'
            ).length;
            // cuotas viene ordenado por numero: la primera no pagada es el próximo vencimiento
            const proxima = cuotas.find(
              (c) => c.estado === 'pendiente' || c.estado === 'vencida'
            );
            lineas.push(
              `- Acuerdo $${acuerdo.monto_total.toLocaleString('es-CL')}: ${pagadas}/${acuerdo.cuotas_total} cuotas pagadas${proxima ? ` (próximo vencimiento: ${proxima.fecha_vencimiento})` : ''}`
            );
          }
          resultText = `Acuerdos activos:\n${lineas.join('\n')}`;
        }
        break;
      }

      case 'close_case': {
        const { motivo_cierre, notas } = input as {
          motivo_cierre: 'pago_total' | 'desistimiento' | 'caducada';
          notas?: string;
        };

        await updateConversationMetadata(conversationId, {
          case_state: 'cerrada',
          motivo_cierre,
        });

        const motivoTexto: Record<string, string> = {
          pago_total: 'pago total recibido',
          desistimiento: 'desistimiento del cliente',
          caducada: 'causa caducada',
        };

        resultText = `✅ Causa cerrada por ${motivoTexto[motivo_cierre] ?? motivo_cierre}${notas ? `. Notas: ${notas}` : ''}`;
        break;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    logger.debug({ toolName, toolUseId }, 'executeTool: success');
    return {
      tool_name: toolName,
      tool_use_id: toolUseId,
      content: resultText,
      isError: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ toolName, toolUseId, error: errorMsg }, 'executeTool: failed');

    return {
      tool_name: toolName,
      tool_use_id: toolUseId,
      content: `❌ Error ejecutando ${toolName}: ${errorMsg}`,
      isError: true,
    };
  }
}

/**
 * Process tool_use blocks from Claude response.
 * Returns structured results to feed back to Claude.
 */
export async function processToolUseBlocks(
  toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  conversationId: string
): Promise<ToolResult[]> {
  const results = await Promise.all(
    toolUseBlocks.map((block) =>
      executeTool(block.name, block.id, block.input, conversationId)
    )
  );
  return results;
}
