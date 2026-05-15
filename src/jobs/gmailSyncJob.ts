import cron from 'node-cron';
import { GmailConnection } from '../models/GmailConnection';
import { addEmailProcessingJob } from '../services/queueService';
import logger from '../utils/logger';

let syncJob: cron.ScheduledTask | null = null;

export const startGmailSyncJob = (): void => {
  // Run every 5 minutes
  syncJob = cron.schedule('*/5 * * * *', async () => {
    logger.info('Running Gmail sync job...');

    try {
      const activeConnections = await GmailConnection.find({ isActive: true });
      logger.info(`Syncing ${activeConnections.length} Gmail connections`);

      const results = await Promise.allSettled(
        activeConnections.map(conn =>
          addEmailProcessingJob(
            (conn.userId as string).toString(),
            (conn._id as string).toString()
          )
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info(`Gmail sync job: ${successful} queued, ${failed} failed`);
    } catch (error) {
      logger.error('Gmail sync job error:', error);
    }
  });

  logger.info('Gmail sync cron job started (every 5 minutes)');
};

export const stopGmailSyncJob = (): void => {
  if (syncJob) {
    syncJob.stop();
    syncJob = null;
    logger.info('Gmail sync cron job stopped');
  }
};

export default { startGmailSyncJob, stopGmailSyncJob };
