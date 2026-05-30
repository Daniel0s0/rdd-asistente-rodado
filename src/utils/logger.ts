import pino from 'pino';
import { getEnv } from '@config/env';

let loggerInstance: pino.Logger | null = null;

export function createLogger(): pino.Logger {
  const env = getEnv();

  const isDev = env.NODE_ENV === 'development';

  if (isDev) {
    return pino(
      {
        level: env.LOG_LEVEL,
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
