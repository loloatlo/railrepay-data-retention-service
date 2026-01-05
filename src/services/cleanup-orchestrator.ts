/**
 * CleanupOrchestrator
 *
 * Service layer that orchestrates data retention cleanup operations.
 *
 * Responsibilities:
 *   - Load enabled retention policies
 *   - Execute appropriate cleanup strategy for each policy
 *   - Record cleanup history (audit trail)
 *   - Create outbox events for downstream consumers
 *   - Handle failures gracefully
 *
 * Per ADR-007: Uses transactional outbox pattern for event publishing.
 */

import type { RetentionPolicyRepository } from '../repositories/retention-policy.repository';
import type { CleanupHistoryRepository } from '../repositories/cleanup-history.repository';
import type { CleanupStrategy, RetentionPolicy } from '../strategies/cleanup-strategy.interface';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';

export class CleanupOrchestrator {
  constructor(
    private policyRepo: RetentionPolicyRepository,
    private historyRepo: CleanupHistoryRepository,
    private db: any,
    private strategies: Map<string, CleanupStrategy>
  ) {}

  async executeAll(dryRun: boolean): Promise<void> {
    const policies = await this.policyRepo.findEnabled();

    logger.info('CleanupOrchestrator: Starting cleanup', {
      policiesCount: policies.length,
      dryRun,
    });

    for (const policy of policies) {
      await this.executePolicy(policy, dryRun);
    }

    logger.info('CleanupOrchestrator: Cleanup complete', {
      policiesProcessed: policies.length,
    });
  }

  private async executePolicy(policy: RetentionPolicy, dryRun: boolean): Promise<void> {
    const strategy = this.strategies.get(policy.cleanup_strategy);

    if (!strategy) {
      logger.error('CleanupOrchestrator: Strategy not found', {
        policy_id: policy.id,
        cleanup_strategy: policy.cleanup_strategy,
      });
      return;
    }

    // Create history record (audit trail)
    const historyId = await this.historyRepo.create({
      policy_id: policy.id,
      target_schema: policy.target_schema,
      started_at: new Date(),
      status: 'running',
    });

    try {
      logger.info('CleanupOrchestrator: Executing strategy', {
        policy_id: policy.id,
        target_schema: policy.target_schema,
        strategy: strategy.name,
        dryRun,
      });

      // Execute cleanup strategy
      const result = await strategy.execute(policy, dryRun);

      logger.info('CleanupOrchestrator: Strategy completed', {
        policy_id: policy.id,
        result,
      });

      // Use transaction to ensure atomic write of history + outbox event
      await this.db.tx(async (t: any) => {
        // Update history record
        await this.historyRepo.complete(historyId, {
          recordsDeleted: result.recordsDeleted,
          partitionsDropped: result.partitionsDropped,
          gcsFilesDeleted: result.gcsFilesDeleted,
          status: 'success',
          completed_at: new Date(),
        });

        // Update policy last_cleanup_at
        await this.policyRepo.updateLastCleanup(policy.id, new Date());

        // Create outbox event (transactional outbox pattern per ADR-007)
        const correlationId = uuidv4();
        await t.none(
          `
          INSERT INTO data_retention.outbox
            (aggregate_id, aggregate_type, event_type, payload, correlation_id)
          VALUES ($1, $2, $3, $4, $5)
        `,
          [
            policy.id,
            'RetentionPolicy',
            'cleanup.completed',
            JSON.stringify({
              policy_id: policy.id,
              target_schema: policy.target_schema,
              cleanup_strategy: policy.cleanup_strategy,
              records_deleted: result.recordsDeleted,
              partitions_dropped: result.partitionsDropped,
              gcs_files_deleted: result.gcsFilesDeleted,
              dry_run: dryRun,
              completed_at: new Date().toISOString(),
            }),
            correlationId,
          ]
        );
      });
    } catch (error: any) {
      logger.error('CleanupOrchestrator: Strategy failed', {
        policy_id: policy.id,
        error: error.message,
        stack: error.stack,
      });

      // Update history with failure
      await this.historyRepo.complete(historyId, {
        recordsDeleted: 0,
        partitionsDropped: [],
        gcsFilesDeleted: 0,
        status: 'failed',
        completed_at: new Date(),
        error_message: error.message,
      });
    }
  }
}
