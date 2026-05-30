/**
 * message-parser.ts
 *
 * Message parsing utilities for RDD agent conversations.
 * Extracts user intent and financial data from natural language messages.
 */

import { logger } from '@utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Intent = 'acuerdo' | 'pago' | 'cierre' | 'consulta' | 'otro';

export interface FinancialData {
  monto?: number;
  cuotas?: number;
  fecha?: string;
  porcentajeHonorarios?: number;
}

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// parseUserIntent
// ---------------------------------------------------------------------------

/**
 * Determines the user's intent from a natural language message.
 * Priority order: cierre > acuerdo > pago > consulta > otro
 */
export function parseUserIntent(userMessage: string): Intent {
  const lower = userMessage.toLowerCase();

  // cierre takes highest priority
  if (
    lower.includes('cierre') ||
    lower.includes('archivo') ||
    lower.includes('terminado') ||
    lower.includes('finalizado')
  ) {
    return 'cierre';
  }

  // acuerdo: includes money patterns or negotiation keywords
  const hasMoneyPattern = /\$[\d.,]+/.test(userMessage);
  const hasPagoYCuota = lower.includes('pago') && lower.includes('cuota');

  if (
    lower.includes('acuerdo') ||
    lower.includes('acuerda') ||
    lower.includes('negociado') ||
    hasPagoYCuota ||
    hasMoneyPattern
  ) {
    return 'acuerdo';
  }

  // pago: payment-related keywords
  if (
    lower.includes('pagó') ||
    lower.includes('pagado') ||
    lower.includes('pago') ||
    lower.includes('transferencia') ||
    lower.includes('consignación')
  ) {
    return 'pago';
  }

  // consulta: question keywords or question mark
  if (
    lower.includes('cuánto') ||
    lower.includes('cuándo') ||
    userMessage.includes('?')
  ) {
    return 'consulta';
  }

  return 'otro';
}

// ---------------------------------------------------------------------------
// extractMonto
// ---------------------------------------------------------------------------

/**
 * Extracts a monetary amount from the message.
 * Supports: $1,800,000 | $1.800.000 | 1 millón 800 mil | 1800k | 1.8M
 */
function extractMonto(message: string): number | undefined {
  // Pattern 1: $ followed by digits with separators  (spec regex)
  const dollarMatch = message.match(/\$[\s]*([\d.,]+)/);
  if (dollarMatch) {
    const raw = dollarMatch[1].replace(/\./g, '').replace(/,/g, '');
    const amount = parseFloat(raw);
    if (!isNaN(amount) && amount > 0 && amount <= 1_000_000_000) {
      return amount;
    }
  }

  // Pattern 2: Millions in Spanish — "1.8 millones" or "1 millón"  (spec regex)
  const millionMatch = message.match(/([\d.]+)\s*(?:millón|millones)/i);
  if (millionMatch) {
    const amount = parseFloat(millionMatch[1]) * 1_000_000;
    if (!isNaN(amount) && amount > 0 && amount <= 1_000_000_000) {
      return Math.round(amount);
    }
  }

  // Pattern 3: k (thousands) or M (millions) suffix  (spec regex)
  const kMatch = message.match(/([\d.]+)\s*[kK]/i);
  if (kMatch) {
    const amount = parseFloat(kMatch[1]) * 1_000;
    if (!isNaN(amount) && amount > 0 && amount <= 1_000_000_000) {
      return Math.round(amount);
    }
  }

  const mMatch = message.match(/([\d.]+)\s*M\b/);
  if (mMatch) {
    const amount = parseFloat(mMatch[1]) * 1_000_000;
    if (!isNaN(amount) && amount > 0 && amount <= 1_000_000_000) {
      return Math.round(amount);
    }
  }

  // Pattern 4: Composite Spanish — "1 millón 800 mil"
  const compositeMatch = message.match(
    /(\d+)\s*mill[oó]n(?:es)?\s*(?:(\d+)\s*mil)?/i
  );
  if (compositeMatch) {
    const millions = parseInt(compositeMatch[1], 10) * 1_000_000;
    const thousands = compositeMatch[2] ? parseInt(compositeMatch[2], 10) * 1_000 : 0;
    const amount = millions + thousands;
    if (amount > 0 && amount <= 1_000_000_000) {
      return amount;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// extractCuotas
// ---------------------------------------------------------------------------

/**
 * Extracts the number of installments from the message.
 * Supports: "12 cuotas", "en 12 cuotas", "en 12 meses", "en 12 pagos"
 */
function extractCuotas(message: string): number | undefined {
  // spec regex
  const match = message.match(/(?:en\s+)?([\d]+)\s*(?:cuota|cuotas|mes|meses|pago|pagos)/i);
  if (match) {
    const cuotas = parseInt(match[1], 10);
    if (Number.isInteger(cuotas) && cuotas > 0 && cuotas <= 360) {
      return cuotas;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Month map for Spanish date parsing
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

// ---------------------------------------------------------------------------
// extractFecha
// ---------------------------------------------------------------------------

/**
 * Extracts a date from the message and returns it as YYYY-MM-DD.
 * Supports ISO format (2026-06-30) and Spanish format (30 junio 2026 / 30 de junio de 2026).
 * Rejects dates in the past.
 */
function extractFecha(message: string): string | undefined {
  const now = new Date();
  // Zero out time for date comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Pattern 1: ISO date — spec regex
  const isoMatch = message.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(parsed.getTime()) && parsed >= today) {
      return `${year}-${month}-${day}`;
    }
    // If date is in the past or invalid, skip (don't fall through to Spanish)
    if (!isNaN(parsed.getTime())) {
      return undefined;
    }
  }

  // Pattern 2: Spanish format — spec regex
  const spanishMatch = message.match(
    /(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+(?:de\s+)?(\d{4}))?/i
  );
  if (spanishMatch) {
    const [, dayStr, monthName, yearStr] = spanishMatch;
    const monthNum = MONTH_MAP[monthName.toLowerCase()];
    if (monthNum === undefined) {
      return undefined;
    }
    const year = yearStr ? parseInt(yearStr) : now.getFullYear();
    const day = parseInt(dayStr, 10);
    const parsed = new Date(year, monthNum - 1, day);
    if (
      !isNaN(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === monthNum - 1 &&
      parsed.getDate() === day &&
      parsed >= today
    ) {
      const mm = String(monthNum).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// extractPorcentaje
// ---------------------------------------------------------------------------

/**
 * Extracts a percentage from the message.
 * Supports: "20%" or "20 por ciento"
 */
function extractPorcentaje(message: string): number | undefined {
  // Pattern 1: percent symbol  (spec regex)
  const pctMatch = message.match(/([\d.]+)\s*%/i);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      return pct;
    }
  }

  // Pattern 2: words "por ciento"  (spec regex)
  const wordMatch = message.match(/([\d.]+)\s+(?:por\s+)?ciento/i);
  if (wordMatch) {
    const pct = parseFloat(wordMatch[1]);
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      return pct;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// extractFinancialData
// ---------------------------------------------------------------------------

/**
 * Extracts all financial data from a message using the individual extractors.
 * Returns an object with only the fields that were successfully extracted.
 */
export function extractFinancialData(message: string): FinancialData {
  const data: FinancialData = {};

  const monto = extractMonto(message);
  if (monto !== undefined) data.monto = monto;

  const cuotas = extractCuotas(message);
  if (cuotas !== undefined) data.cuotas = cuotas;

  const fecha = extractFecha(message);
  if (fecha !== undefined) data.fecha = fecha;

  const porcentajeHonorarios = extractPorcentaje(message);
  if (porcentajeHonorarios !== undefined) data.porcentajeHonorarios = porcentajeHonorarios;

  logger.debug({ extractedData: data }, 'Financial data extracted');

  return data;
}

// ---------------------------------------------------------------------------
// validateFinancialData (DI #7)
// ---------------------------------------------------------------------------

/**
 * Validates extracted financial data.
 * Throws ValidationError with semicolon-joined messages if any rule is violated.
 *
 * Rules:
 *  - monto: > 0 and <= 1_000_000_000
 *  - cuotas: integer >= 1 and <= 360
 *  - porcentajeHonorarios: 0–100
 *  - fecha: valid ISO date, not in the past
 */
export function validateFinancialData(data: FinancialData): void {
  const errors: string[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (data.monto !== undefined) {
    if (data.monto <= 0) {
      errors.push('Monto debe ser > 0');
    } else if (data.monto > 1_000_000_000) {
      errors.push('Monto parece demasiado grande (> 1 billón)');
    }
  }

  if (data.cuotas !== undefined) {
    if (!Number.isInteger(data.cuotas) || data.cuotas < 1) {
      errors.push('Cuotas debe ser número entero >= 1');
    } else if (data.cuotas > 360) {
      errors.push('Cuotas parece demasiado grande (> 30 años)');
    }
  }

  if (data.porcentajeHonorarios !== undefined) {
    if (data.porcentajeHonorarios < 0 || data.porcentajeHonorarios > 100) {
      errors.push('Porcentaje honorarios debe estar entre 0-100%');
    }
  }

  if (data.fecha !== undefined) {
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.fecha);
    if (!isoMatch) {
      errors.push('Fecha no es válida');
    } else {
      const [, year, month, day] = isoMatch;
      const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const isValidDate =
        !isNaN(parsed.getTime()) &&
        parsed.getFullYear() === parseInt(year) &&
        parsed.getMonth() === parseInt(month) - 1 &&
        parsed.getDate() === parseInt(day);

      if (!isValidDate) {
        errors.push('Fecha no es válida');
      } else if (parsed < today) {
        errors.push('Fecha no puede ser en el pasado');
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('; '));
  }
}
