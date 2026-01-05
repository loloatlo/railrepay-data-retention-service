/**
 * CleanupOrchestrator Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Orchestrator coordinates cleanup execution across all strategies.
 * Responsibilities:
 *   - Load enabled policies
 *   - Execute correct strategy per policy
 *   - Record cleanup history
 *   - Create outbox events
 *   - Handle failures gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CleanupOrchestrator } from '../../../src/services/cleanup-orchestrator';

describe('CleanupOrchestrator', () => {
  let orchestrator: CleanupOrchestrator;
  let mockPolicyRepo: any;
  let mockHistoryRepo: any;
  let mockDb: any;
  let mockStrategies: Map<string, any>;

  beforeEach(() => {
    mockPolicyRepo = {
      findEnabled: vi.fn(),
      updateLastCleanup: vi.fn(),
    };
    mockHistoryRepo = {
      create: vi.fn(),
      complete: vi.fn(),
    };
    mockDb = {
      tx: vi.fn((callback) => callback(mockDb)),
      none: vi.fn(),
    };
    mockStrategies = new Map();

    orchestrator = new CleanupOrchestrator(
      mockPolicyRepo,
      mockHistoryRepo,
      mockDb,
      mockStrategies
    );
  });

  it('should load enabled retention policies', async () => {
    mockPolicyRepo.findEnabled.mockResolvedValue([
      {
        id: '1',
        target_schema: 'darwin_ingestor',
        cleanup_strategy: 'partition_drop',
        retention_days: 31,
        enabled: true,
      },
    ]);

    mockHistoryRepo.create.mockResolvedValue('history-1');
    mockHistoryRepo.complete.mockResolvedValue(undefined);

    const mockStrategy = {
      name: 'PartitionDropStrategy',
      execute: vi.fn().mockResolvedValue({
        recordsDeleted: 0,
        partitionsDropped: ['part_2024_01'],
        gcsFilesDeleted: 0,
        dryRun: false,
      }),
    };

    mockStrategies.set('partition_drop', mockStrategy);

    await orchestrator.executeAll(false);

    expect(mockPolicyRepo.findEnabled).toHaveBeenCalled();
  });

  it('should execute correct strategy per policy', async () => {
    const mockPolicy = {
      id: '1',
      target_schema: 'timetable_loader',
      cleanup_strategy: 'date_delete',
      retention_days: 31,
      enabled: true,
    };

    mockPolicyRepo.findEnabled.mockResolvedValue([mockPolicy]);
    mockHistoryRepo.create.mockResolvedValue('history-1');
    mockHistoryRepo.complete.mockResolvedValue(undefined);

    const mockStrategy = {
      name: 'DateDeleteStrategy',
      execute: vi.fn().mockResolvedValue({
        recordsDeleted: 100,
        partitionsDropped: [],
        gcsFilesDeleted: 0,
        dryRun: false,
      }),
    };

    mockStrategies.set('date_delete', mockStrategy);

    await orchestrator.executeAll(false);

    expect(mockStrategy.execute).toHaveBeenCalledWith(mockPolicy, false);
  });

  it('should record cleanup history', async () => {
    const mockPolicy = {
      id: 'policy-1',
      target_schema: 'darwin_ingestor',
      cleanup_strategy: 'partition_drop',
      retention_days: 31,
      enabled: true,
    };

    mockPolicyRepo.findEnabled.mockResolvedValue([mockPolicy]);
    mockHistoryRepo.create.mockResolvedValue('history-1');
    mockHistoryRepo.complete.mockResolvedValue(undefined);

    const mockStrategy = {
      execute: vi.fn().mockResolvedValue({
        recordsDeleted: 0,
        partitionsDropped: ['part_2024_01'],
        gcsFilesDeleted: 0,
        dryRun: false,
      }),
    };

    mockStrategies.set('partition_drop', mockStrategy);

    await orchestrator.executeAll(false);

    expect(mockHistoryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        policy_id: 'policy-1',
        target_schema: 'darwin_ingestor',
        status: 'running',
      })
    );

    expect(mockHistoryRepo.complete).toHaveBeenCalledWith(
      'history-1',
      expect.objectContaining({
        partitionsDropped: ['part_2024_01'],
        status: 'success',
      })
    );
  });

  it('should create outbox event on completion', async () => {
    const mockPolicy = {
      id: 'policy-1',
      target_schema: 'darwin_ingestor',
      cleanup_strategy: 'partition_drop',
      retention_days: 31,
      enabled: true,
    };

    mockPolicyRepo.findEnabled.mockResolvedValue([mockPolicy]);
    mockHistoryRepo.create.mockResolvedValue('history-1');
    mockHistoryRepo.complete.mockResolvedValue(undefined);

    const mockStrategy = {
      execute: vi.fn().mockResolvedValue({
        recordsDeleted: 0,
        partitionsDropped: ['part_2024_01'],
        gcsFilesDeleted: 0,
        dryRun: false,
      }),
    };

    mockStrategies.set('partition_drop', mockStrategy);

    await orchestrator.executeAll(false);

    // Verify outbox event created (transactional outbox pattern)
    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO data_retention.outbox'),
      expect.any(Array)
    );
  });

  it('should handle strategy failures gracefully', async () => {
    const mockPolicy = {
      id: 'policy-1',
      target_schema: 'darwin_ingestor',
      cleanup_strategy: 'partition_drop',
      retention_days: 31,
      enabled: true,
    };

    mockPolicyRepo.findEnabled.mockResolvedValue([mockPolicy]);
    mockHistoryRepo.create.mockResolvedValue('history-1');
    mockHistoryRepo.complete.mockResolvedValue(undefined);

    const mockStrategy = {
      execute: vi.fn().mockRejectedValue(new Error('Database connection failed')),
    };

    mockStrategies.set('partition_drop', mockStrategy);

    await orchestrator.executeAll(false);

    expect(mockHistoryRepo.complete).toHaveBeenCalledWith(
      'history-1',
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('Database connection failed'),
      })
    );
  });
});
