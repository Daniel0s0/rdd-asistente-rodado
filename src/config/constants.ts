export const SHEET_TABS = {
  REGISTRO: 'REGISTRO',
  DASHBOARD: 'DASHBOARD',
  ANALISIS_FINANCIERO: 'ANÁLISIS FINANCIERO',
  LIQUIDACION: 'LIQUIDACIÓN',
  REPORTES: 'REPORTES',
  CONFIGURACION: 'CONFIGURACIÓN',
} as const;

export const INCOME_TYPES = {
  SENTENCIA: 'Sentencia',
  COBRANZA: 'Cobranza',
  ACUERDO: 'Acuerdo',
} as const;

export const CASE_STATES = {
  ACCEPTED: 'Acogida',
  REJECTED: 'Rechazada',
  EXPIRED: 'Caducada',
  UNCOLLECTIBLE: 'Incobrable',
} as const;

export const CASE_PAYMENT_STATUS = {
  NOT_PAID: 'No Pagada',
  PARTIAL: 'Parcial',
  PAID: 'Pagada',
} as const;

export const DEFAULT_HONOR_PERCENTAGE = 20;

export const GOOGLE_BATCH_SIZE = 100;
export const GOOGLE_API_TIMEOUT_MS = 30000;

export const VERSION = '0.1.0';
