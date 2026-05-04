import { Request, Response, NextFunction } from "express";
import { adminAuth } from "../lib/firebase-admin";

declare global {
  namespace Express {
    interface Request {
      user?: import("firebase-admin/auth").DecodedIdToken;
    }
  }
}

export async function verifyFirebaseToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired Firebase token" });
  }
}
