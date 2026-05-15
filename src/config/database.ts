import mongoose from 'mongoose';
import { config } from './index';
import logger from '../utils/logger';

let isConnected = false;

export const connectDatabase = async (): Promise<void> => {
  if (isConnected) {
    logger.info('Using existing database connection');
    return;
  }

  try {
    const conn = await mongoose.connect(config.mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    logger.info(`MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      isConnected = true;
    });

  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  logger.info('MongoDB disconnected');
};

export default connectDatabase;
