import cron from 'node-cron';
import { GmailConnection } from '../models/GmailConnection';
import { setupGmailWatch } from '../services/gmailService';
import logger from '../utils/logger';

let renewalJob: cron.ScheduledTask | null = null;

export const startGmailWatchRenewalJob = (): void => {
  // Run daily at 2 AM
  renewalJob = cron.schedule('0 2 * * *', async () => {
    logger.info('Running Gmail watch renewal job...');

    try {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Find connections whose watch expires within 24 hours or has already expired
      const expiringConnections = await GmailConnection.find({
        isActive: true,
        $or: [
          { watchExpiry: { $lt: tomorrow } },
          { watchExpiry: null },
        ],
      });

      logger.info(`Renewing ${expiringConnections.length} Gmail watch subscriptions`);

      for (const conn of expiringConnections) {
        try {
          await setupGmailWatch(conn);
          logger.info(`Gmail watch renewed for ${conn.email}`);
        } catch (error) {
          logger.error(`Failed to renew watch for ${conn.email}:`, error);
        }
      }
    } catch (error) {
      logger.error('Gmail watch renewal job error:', error);
    }
  });

  logger.info('Gmail watch renewal cron job started (daily at 2 AM)');
};

export const stopGmailWatchRenewalJob = (): void => {
  if (renewalJob) {
    renewalJob.stop();
    renewalJob = null;
    logger.info('Gmail watch renewal cron job stopped');
  }
};

export default { startGmailWatchRenewalJob, stopGmailWatchRenewalJob };
