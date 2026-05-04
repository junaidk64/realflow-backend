import { Request, Response, NextFunction } from "express";
import { ratelimit } from "../lib/redis";

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const identifier = req.user?.uid ?? req.ip ?? "unknown";
  const { success } = await ratelimit.limit(identifier);

  if (!success) {
    return res.status(429).json({ error: "Too many requests. Slow down." });
  }

  next();
}
