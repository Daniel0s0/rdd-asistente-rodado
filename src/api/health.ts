import { Request, Response } from 'express';
import { VERSION } from '@config/constants';
import { getEnv } from '@config/env';

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
