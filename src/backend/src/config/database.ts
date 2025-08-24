import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export const connectDatabase = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/security-dependency-tool';
    
    if (!mongoUri) {
      logger.info('MongoDB URI not configured, skipping database connection');
      return;
    }

    await mongoose.connect(mongoUri, {
      // Mongoose 6+ doesn't need these options but they're harmless
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });

    logger.info('Connected to MongoDB successfully');

    // Handle connection events
    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    // Don't exit the process, just log the error
    // The app can still work without persistence
  }
}; 