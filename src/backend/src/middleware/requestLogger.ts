import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Store original json method to capture response data
  const originalJson = res.json;
  let responseData: any;
  
  res.json = function(data: any) {
    responseData = data;
    return originalJson.call(this, data);
  };

  // Log request
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    headers: {
      authorization: req.get('Authorization') ? '[REDACTED]' : undefined,
      'content-type': req.get('Content-Type'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
    },
    query: req.query,
    body: sanitizeRequestBody(req.body),
  });

  // Listen for response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Determine log level based on status code
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(logLevel, 'Request completed', {
      method: req.method,
      url: req.url,
      statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      responseSize: res.get('Content-Length'),
      response: sanitizeResponseData(responseData, statusCode),
    });
  });

  next();
};

// Sanitize request body to remove sensitive information
const sanitizeRequestBody = (body: any): any => {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'githubToken',
    'jiraToken',
    'jiraApiToken',
    'apiKey',
    'accessToken',
    'refreshToken',
  ];

  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  // Recursively sanitize nested objects
  for (const [key, value] of Object.entries(sanitized)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeRequestBody(value);
    }
  }

  return sanitized;
};

// Sanitize response data for logging
const sanitizeResponseData = (data: any, statusCode: number): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  // Don't log response data for successful requests (to avoid noise)
  if (statusCode >= 200 && statusCode < 300) {
    return {
      type: typeof data,
      keys: Object.keys(data),
      hasData: true,
    };
  }

  // For error responses, log more details but still sanitize
  const sanitized = { ...data };
  
  // Remove sensitive information from error responses too
  const sensitiveFields = ['token', 'secret', 'key', 'password'];
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
};

export default requestLogger; 