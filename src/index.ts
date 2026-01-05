/**
 * Data Retention Service
 *
 * Main entry point for the data retention cleanup service.
 *
 * Responsibilities:
 *   - Expose health and metrics endpoints
 *   - Execute cleanup on startup (cron job mode)
 *   - Graceful shutdown
 *
 * Per Deployment Readiness Standards: Configured for Railway proxy environment.
 */

import express from 'express';
import { Storage } from '@google-cloud/storage';
import { config } from './config';
import { logger } from './config/logger';
import { db } from './database/client';
import { healthRoutes } from './api/health-routes';
import { metricsRoutes } from './api/metrics-routes';
import { CleanupOrchestrator } from './services/cleanup-orchestrator';
import { RetentionPolicyRepository } from './repositories/retention-policy.repository';
import { CleanupHistoryRepository } from './repositories/cleanup-history.repository';
import { PartitionDropStrategy } from './strategies/partition-drop.strategy';
import { DateDeleteStrategy } from './strategies/date-delete.strategy';
import { GCSCleanupStrategy } from './strategies/gcs-cleanup.strategy';

const app = express();

// CRITICAL: Required for Railway/proxy environments (Deployment Readiness Standard)
app.set('trust proxy', true);

// Middleware
app.use(express.json());

// Routes
app.use(healthRoutes);
app.use(metricsRoutes);

// Initialize strategies
const gcsClient = new Storage({
  projectId: config.gcs.projectId,
  keyFilename: config.gcs.keyFilename,
});

const strategies = new Map();
strategies.set('partition_drop', new PartitionDropStrategy(db));
strategies.set('date_delete', new DateDeleteStrategy(db));
strategies.set('gcs_cleanup', new GCSCleanupStrategy(gcsClient));

// Initialize repositories and orchestrator
const policyRepo = new RetentionPolicyRepository(db);
const historyRepo = new CleanupHistoryRepository(db);
const orchestrator = new CleanupOrchestrator(policyRepo, historyRepo, db, strategies);

// Main execution function
async function executeCleanup() {
  const dryRun = process.env.DRY_RUN === 'true';

  logger.info('Data Retention Service: Starting cleanup execution', {
    dryRun,
    nodeEnv: config.nodeEnv,
  });

  try {
    await orchestrator.executeAll(dryRun);
    logger.info('Data Retention Service: Cleanup execution complete');
  } catch (error: any) {
    logger.error('Data Retention Service: Cleanup execution failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Start server
const server = app.listen(config.port, async () => {
  logger.info(`Data Retention Service: Server started on port ${config.port}`);

  // Execute cleanup on startup (cron job mode)
  if (process.env.RUN_ON_STARTUP !== 'false') {
    await executeCleanup();

    // Exit after completion if not in continuous mode
    if (process.env.CONTINUOUS_MODE !== 'true') {
      logger.info('Data Retention Service: Exiting after cleanup (cron job mode)');
      process.exit(0);
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Data Retention Service: SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Data Retention Service: Server closed');
    process.exit(0);
  });
});

export { app };
