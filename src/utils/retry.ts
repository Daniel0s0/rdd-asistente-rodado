import { logger } from './logger';
import { getEnv } from '@config/env';

const RETRY_BASE_DELAY_MS = 1000;

/**
 * Reintentar una operación con backoff exponencial.
 * Cumple DI #6 (Rate Limiting) y DI #9 (Error Recovery).
 *
 * Reintentables (429 rate limit, 5xx servidor): con backoff 1s → 2s → 4s
 * No reintentables (4xx distintos a 429): se lanzan inmediatamente.
 * Patrón de espera: 1s → 2s → 4s (si maxAttempts = 3).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = getEnv().GOOGLE_API_MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error as any;
      lastError = error as Error;

      // Determinar si el error es reintentable (429 rate limit o 5xx servidor)
      const statusCode = err.code ?? err.status ?? 0;
      const isRetryable = statusCode === 429 || statusCode >= 500;

      if (isRetryable && attempt < maxAttempts - 1) {
        // Backoff exponencial: 1s, 2s, 4s, ...
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(
          { attempt: attempt + 1, maxAttempts, delayMs, codigo: statusCode },
          'Solicitud a Google API falló, reintentando con backoff'
        );
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      } else if (!isRetryable) {
        // Error no reintentable (401, 403, 404, etc.) — lanzar inmediatamente
        throw error;
      }
      // Si es reintentable pero ya agotamos intentos, salir del loop
    }
  }

  // Todos los intentos agotados
  if (lastError) {
    throw lastError;
  }
  throw new Error('Error desconocido en retryWithBackoff');
}
