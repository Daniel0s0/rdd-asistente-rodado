import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getEnv } from '@config/env';
import { getLogger } from '@utils/logger';

const logger = getLogger();

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    logger.warn('Missing Authorization header');
    res.status(401).json({ success: false, error: 'unauthorized', message: 'Missing Authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    logger.warn('Invalid Authorization header format');
    res.status(401).json({ success: false, error: 'unauthorized', message: 'Invalid Authorization header' });
    return;
  }

  const providedKey = parts[1];
  const expectedKey = getEnv().UI_API_KEY;

  // Use timing-safe comparison to prevent timing attacks
  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    isValid = false;
  }

  if (!isValid) {
    logger.warn('Invalid API key');
    res.status(401).json({ success: false, error: 'unauthorized', message: 'Invalid API key' });
    return;
  }

  next();
}
