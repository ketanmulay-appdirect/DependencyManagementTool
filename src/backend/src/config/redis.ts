import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

let redisClient: RedisClientType | null = null;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    if (!redisUrl) {
      logger.info('Redis URL not configured, skipping Redis connection');
      return;
    }

    redisClient = createClient({
      url: redisUrl,
    });

    redisClient.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis successfully');
    });

    redisClient.on('disconnect', () => {
      logger.warn('Redis disconnected');
    });

    await redisClient.connect();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      if (redisClient) {
        await redisClient.quit();
        logger.info('Redis connection closed through app termination');
      }
    });

  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    // Don't exit the process, just log the error
    // The app can still work without caching
  }
};

export const getRedisClient = (): RedisClientType | null => {
  return redisClient;
}; 