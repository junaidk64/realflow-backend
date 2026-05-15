import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export const createError = (message: string, statusCode: number, code?: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.isOperational = true;
  return error;
};

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code;
  let errors: unknown[] = [];

  // Zod validation errors
  if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    errors = err.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
  }

  // Mongoose duplicate key error
  if ((err as unknown as { code: number }).code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    code = 'DUPLICATE_ERROR';
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    code = 'INVALID_ID';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }

  // Log server errors
  if (statusCode >= 500) {
    logger.error(`Server Error: ${message}`, {
      statusCode,
      path: req.path,
      method: req.method,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(errors.length > 0 && { errors }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
  });
};

export default errorHandler;
