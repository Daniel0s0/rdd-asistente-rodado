import rateLimit from 'express-rate-limit';
import { getEnv } from '@config/env';
import { getLogger } from '@utils/logger';

const logger = getLogger('middleware:rate-limit');

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => getEnv().WEBHOOK_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Webhook rate limit exceeded');
    res.status(429).json({
      success: false,
      error: 'too_many_requests',
      message: 'Rate limit exceeded for webhooks',
      retryAfter: 60,
    });
  },
  skip: (req) => {
    return req.path.includes('/health');
  },
});

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => getEnv().CHAT_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Chat rate limit exceeded');
    res.status(429).json({
      success: false,
      error: 'too_many_requests',
      message: 'Rate limit exceeded for chat',
      retryAfter: 60,
    });
  },
  skip: (req) => {
    return req.path.includes('/health');
  },
});
