import './config/env-loader';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { healthHandler } from '@api/health';
import {
  webhookCausaNuevaHandler,
  webhookCasoModificacionHandler,
  webhookCasoCierreHandler,
} from '@api/webhook';
import { agentChatHandler } from '@api/agent';
import { requireApiKey } from '@middleware/auth';
import { webhookLimiter, chatLimiter } from '@middleware/rate-limit';

function main() {
  const env = getEnv();
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature'],
      credentials: false,
    })
  );
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  app.get('/health', healthHandler);
  app.post('/webhook/causa-nueva', webhookLimiter, webhookCausaNuevaHandler);
  app.post('/webhook/caso-modificacion', webhookLimiter, webhookCasoModificacionHandler);
  app.post('/webhook/caso-cierre', webhookLimiter, webhookCasoCierreHandler);
  app.post('/agent/chat', requireApiKey, chatLimiter, agentChatHandler);

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
