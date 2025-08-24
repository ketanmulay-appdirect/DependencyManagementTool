import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from './errorHandler';
import { logger } from '../utils/logger';

// Extend Request interface to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        organizationId: string;
      };
    }
  }
}

export const validateAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.get('Authorization');
    
    if (!authHeader) {
      throw new UnauthorizedError('No authorization header provided');
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      throw new Error('Authentication configuration error');
    }

    const decoded = jwt.verify(token, jwtSecret) as any;
    
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      organizationId: decoded.organizationId,
    };

    logger.debug('User authenticated', {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
};

// Optional auth middleware (doesn't throw error if no token)
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.get('Authorization');
    
    if (!authHeader) {
      return next();
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return next();
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return next();
    }

    const decoded = jwt.verify(token, jwtSecret) as any;
    
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      organizationId: decoded.organizationId,
    };

    next();
  } catch (error) {
    // Ignore authentication errors for optional auth
    next();
  }
};

// Role-based authorization
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      throw new UnauthorizedError('Insufficient permissions');
    }

    next();
  };
};

// API key validation (for external integrations)
export const validateApiKey = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const apiKey = req.get('X-API-Key') || req.query.apiKey as string;
    
    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }

    // In a real implementation, you would validate the API key against a database
    // For now, we'll just check if it's the configured API key
    const validApiKey = process.env.API_KEY;
    
    if (!validApiKey || apiKey !== validApiKey) {
      throw new UnauthorizedError('Invalid API key');
    }

    logger.debug('API key validated', {
      apiKeyPrefix: apiKey.substring(0, 8) + '...',
      ip: req.ip,
    });

    next();
  } catch (error) {
    next(error);
  }
};

// Generate JWT token (for authentication endpoints)
export const generateToken = (user: {
  id: string;
  email: string;
  role: string;
  organizationId: string;
}): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };

  // Use number for expiresIn (7 days in seconds)
  const options = {
    expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
    issuer: 'security-dependency-tool',
  };

  return jwt.sign(payload, jwtSecret, options);
};

export default validateAuth; 