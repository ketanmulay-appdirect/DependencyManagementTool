import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { APIError } from '../types';

export interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, any>;
}

export const errorHandler = (
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Ensure we don't send response twice
  if (res.headersSent) {
    return next(error);
  }

  // Log the error
  logger.error('Error occurred:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Default error response
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal Server Error';
  let code = error.code || 'INTERNAL_ERROR';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    code = 'VALIDATION_ERROR';
  } else if (error.name === 'UnauthorizedError' || error.message?.includes('unauthorized')) {
    statusCode = 401;
    message = 'Unauthorized';
    code = 'UNAUTHORIZED';
  } else if (error.name === 'ForbiddenError' || error.message?.includes('forbidden')) {
    statusCode = 403;
    message = 'Forbidden';
    code = 'FORBIDDEN';
  } else if (error.name === 'NotFoundError' || error.message?.includes('not found')) {
    statusCode = 404;
    message = 'Not Found';
    code = 'NOT_FOUND';
  } else if (error.name === 'ConflictError' || error.message?.includes('conflict')) {
    statusCode = 409;
    message = 'Conflict';
    code = 'CONFLICT';
  } else if (error.name === 'RateLimitError' || error.message?.includes('rate limit')) {
    statusCode = 429;
    message = 'Too Many Requests';
    code = 'RATE_LIMIT_EXCEEDED';
  }

  // GitHub API errors
  if (error.message?.includes('GitHub')) {
    if (error.message.includes('401')) {
      statusCode = 401;
      message = 'Invalid GitHub token';
      code = 'GITHUB_AUTH_ERROR';
    } else if (error.message.includes('404')) {
      statusCode = 404;
      message = 'GitHub repository not found';
      code = 'GITHUB_REPO_NOT_FOUND';
    } else if (error.message.includes('403')) {
      statusCode = 403;
      message = 'GitHub API rate limit exceeded or insufficient permissions';
      code = 'GITHUB_RATE_LIMIT';
    }
  }

  // JIRA API errors
  if (error.message?.includes('JIRA')) {
    if (error.message.includes('401')) {
      statusCode = 401;
      message = 'Invalid JIRA credentials';
      code = 'JIRA_AUTH_ERROR';
    } else if (error.message.includes('404')) {
      statusCode = 404;
      message = 'JIRA ticket not found';
      code = 'JIRA_TICKET_NOT_FOUND';
    }
  }

  // Database connection errors
  if (error.message?.includes('MongoError') || error.message?.includes('connection')) {
    statusCode = 503;
    message = 'Database connection error';
    code = 'DATABASE_ERROR';
  }

  // Create error response
  const errorResponse: APIError = {
    code,
    message,
    details: process.env.NODE_ENV === 'development' ? {
      originalError: error.message,
      stack: error.stack,
      ...error.details,
    } : error.details,
    timestamp: new Date(),
  };

  // Ensure we always send JSON response with proper content type
  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json({
    success: false,
    error: errorResponse,
  });
};

// Async error wrapper
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error classes
export class ValidationError extends Error {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  
  constructor(message: string, public field?: string, public value?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends Error {
  statusCode = 401;
  code = 'UNAUTHORIZED';
  
  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  code = 'FORBIDDEN';
  
  constructor(message: string = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  code = 'NOT_FOUND';
  
  constructor(message: string = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  code = 'CONFLICT';
  
  constructor(message: string = 'Conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  code = 'RATE_LIMIT_EXCEEDED';
  
  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
} 