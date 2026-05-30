import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { healthHandler } from '@api/health';
import { webhookCausaNuevaHandler } from '@api/webhook';

function main() {
  const env = getEnv();
  const app = express();

  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  app.get('/health', healthHandler);
  app.post('/webhook/causa-nueva', webhookCausaNuevaHandler);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  });

  app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      'RDD server started'
    );
  });
}

main();
