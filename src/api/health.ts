import { Request, Response } from 'express';
import { VERSION } from '@config/constants';
import { getEnv } from '@config/env';
import { getDb } from '@database/supabase';
import { logger } from '@utils/logger';

const startTime = Date.now();

export function healthHandler(_req: Request, res: Response): void {
  const env = getEnv();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    status: 'ok',
    uptime: uptimeSeconds,
    version: VERSION,
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /health/ready — readiness check (Etapa 1.2)
 * Valida dependencias reales: Supabase alcanzable + config Google presente.
 * 200 si todo ok, 503 degraded si alguna dependencia falla.
 */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const services = {
    supabase: false,
    google_config: false,
  };

  try {
    const { error } = await getDb().from('conversations').select('id').limit(1);
    services.supabase = !error;
    if (error) {
      logger.warn({ error: error.message }, 'Readiness: Supabase check failed');
    }
  } catch (error) {
    logger.warn({ error }, 'Readiness: Supabase unreachable');
  }

  services.google_config = Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 &&
      env.GOOGLE_SHEETS_SPREADSHEET_ID
  );

  const ok = services.supabase && services.google_config;

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    services,
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
}
