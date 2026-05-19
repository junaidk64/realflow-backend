import rateLimit from 'express-rate-limit'
import { Redis } from 'ioredis'
import { NextFunction, Request, Response } from 'express'
import { config } from '../config'

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    code: 'AUTH_RATE_LIMIT',
  },
  skipSuccessfulRequests: true,
})

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    message: 'API rate limit exceeded.',
    code: 'API_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Webhook rate limit exceeded.',
    code: 'WEBHOOK_RATE_LIMIT',
  },
})

// Redis client shared for per-user rate limiting
let _redis: Redis | null = null
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.redis.url)
    _redis.on('error', () => {}) // swallow redis errors in limiter
  }
  return _redis
}

/**
 * Per-user Redis-backed rate limiter.
 * Falls back silently if Redis is unavailable (never blocks legitimate traffic).
 */
export function perUserRateLimit(maxRequests: number, windowSec: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as Request & { user?: { userId?: string } }).user?.userId
    if (!userId) {
      next()
      return
    }

    try {
      const redis = getRedis()
      const key = `rl:${userId}:${req.path}`
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, windowSec)

      if (count > maxRequests) {
        res.status(429).json({
          success: false,
          message: 'Rate limit exceeded. Please slow down.',
          code: 'USER_RATE_LIMIT',
        })
        return
      }
    } catch {
      // Redis failure — let the request through
    }

    next()
  }
}

export default { globalLimiter, authLimiter, apiLimiter, webhookLimiter, perUserRateLimit }
