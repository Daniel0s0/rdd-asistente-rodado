import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContext } from '@utils/logger';

/**
 * Etapa 3.3: asigna un requestId a cada request HTTP.
 * - Respeta x-request-id entrante (correlación con el SaaS) o genera UUID.
 * - Lo devuelve en el header x-request-id de la respuesta.
 * - Lo guarda en requestContext: el mixin de Pino lo agrega a todos los logs
 *   del ciclo de vida del request.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();

  res.setHeader('x-request-id', requestId);
  requestContext.run({ requestId }, () => next());
}
