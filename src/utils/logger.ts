import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { getEnv } from '@config/env';

/**
 * Contexto por request (Etapa 3.3): el middleware request-id lo puebla y el
 * mixin de Pino inyecta requestId en CADA línea de log emitida durante ese
 * request (incluyendo continuaciones async), sin tocar los call sites.
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

function requestMixin(): Record<string, unknown> {
  return requestContext.getStore() ?? {};
}

let loggerInstance: pino.Logger | null = null;

export function createLogger(): pino.Logger {
  const env = getEnv();

  const isDev = env.NODE_ENV === 'development';

  if (isDev) {
    return pino(
      {
        level: env.LOG_LEVEL,
        mixin: requestMixin,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: false,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    );
  }

  return pino({
    level: env.LOG_LEVEL,
    mixin: requestMixin,
    base: {
      version: env.NODE_ENV,
    },
  });
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

export const logger = getLogger();
