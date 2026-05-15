import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    code: 'AUTH_RATE_LIMIT',
  },
  skipSuccessfulRequests: true,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: {
    success: false,
    message: 'API rate limit exceeded.',
    code: 'API_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Webhook rate limit exceeded.',
    code: 'WEBHOOK_RATE_LIMIT',
  },
});

export default { globalLimiter, authLimiter, apiLimiter, webhookLimiter };
