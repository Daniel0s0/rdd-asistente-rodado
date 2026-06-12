import './config/env-loader';
import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { healthHandler, readyHandler } from '@api/health';
import {
  webhookCausaNuevaHandler,
  webhookCasoModificacionHandler,
  webhookCasoCierreHandler,
  webhookCasoEtapaHandler,
} from '@api/webhook';
import { agentChatHandler, portfolioChatHandler } from '@api/agent';
import { casesHandler } from '@api/cases';
import {
  handleGetCartera,
  handleGetIngresos,
  handleGetAcuerdos,
  handleGetResultados,
  handleCreateRegistro,
  handleGetCaseDetail,
} from '@api/analytics';
import { registerSocketHandlers } from '@api/socket-handler';
import { requireApiKey } from '@middleware/auth';
import { requestIdMiddleware } from '@middleware/request-id';
import { webhookLimiter, chatLimiter } from '@middleware/rate-limit';
import type { ClientToServerEvents, ServerToClientEvents } from '@domain/agent';

// Etapa 1.1: errores no capturados nunca deben matar el proceso en silencio.
// Se loguean y se sale con código 1 para que PM2 reinicie.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception — exiting');
  process.exit(1);
});

function main() {
  const env = getEnv();
  const app = express();

  // In development, allow unsafe-eval for socket.io; in production keep strict CSP
  const helmetConfig = env.NODE_ENV === 'development'
    ? { contentSecurityPolicy: false }
    : { contentSecurityPolicy: { directives: { scriptSrc: ["'self'", "'unsafe-eval'"] } } };
  app.use(helmet(helmetConfig));
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature'],
      credentials: false,
    })
  );
  app.use(express.json());
  app.use(requestIdMiddleware);

  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  app.get('/health', healthHandler);
  app.get('/health/ready', readyHandler);
  app.post('/webhook/causa-nueva', webhookLimiter, webhookCausaNuevaHandler);
  app.post('/webhook/caso-modificacion', webhookLimiter, webhookCasoModificacionHandler);
  app.post('/webhook/caso-cierre', webhookLimiter, webhookCasoCierreHandler);
  app.post('/webhook/caso-etapa', webhookLimiter, webhookCasoEtapaHandler);
  app.post('/agent/chat', requireApiKey, chatLimiter, agentChatHandler);
  app.post('/agent/portfolio-chat', requireApiKey, chatLimiter, portfolioChatHandler);
  app.get('/cases', requireApiKey, chatLimiter, casesHandler);

  app.get('/analytics/cartera', requireApiKey, handleGetCartera);
  app.get('/analytics/ingresos', requireApiKey, handleGetIngresos);
  app.get('/analytics/acuerdos', requireApiKey, handleGetAcuerdos);
  app.get('/analytics/resultados', requireApiKey, handleGetResultados);
  app.post('/financials/registro', requireApiKey, handleCreateRegistro);
  app.get('/analytics/case/:causaId', requireApiKey, handleGetCaseDetail);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  });

  const httpServer = http.createServer(app);

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST'],
    },
  });

  registerSocketHandlers(io);

  httpServer.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      'RDD server started'
    );
    // PM2 wait_ready: avisa que el server está listo para recibir tráfico
    if (process.send) {
      process.send('ready');
    }
  });

  // Etapa 1.1: graceful shutdown — cierra Socket.io y drena conexiones HTTP
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received — closing server');
    io.close();
    httpServer.close(() => {
      logger.info('Server closed — exiting');
      process.exit(0);
    });
    // Si las conexiones no drenan en 10s, salida forzada
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
