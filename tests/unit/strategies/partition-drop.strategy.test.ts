/**
 * PartitionDropStrategy Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Target: darwin_ingestor.delay_services and darwin_ingestor.delay_service_stops
 * Strategy: Identify partitions older than retention period (31 days) and drop them
 * Partition naming: delay_services_YYYY_MM, delay_service_stops_YYYY_MM
 *
 * Related: Notion › Data Layer §Table Partitioning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';
import { PartitionDropStrategy } from '../../../src/strategies/partition-drop.strategy';

describe('PartitionDropStrategy', () => {
  let strategy: PartitionDropStrategy;
  let mockDbClient: any;

  beforeEach(() => {
    mockDbClient = {
      query: vi.fn(),
      none: vi.fn(),
    };
    strategy = new PartitionDropStrategy(mockDbClient);
  });

  it('should have name "PartitionDropStrategy"', () => {
    expect(strategy.name).toBe('PartitionDropStrategy');
  });

  it('should identify partitions older than retention period', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock response: partitions from pg_partitions view
    mockDbClient.query.mockResolvedValueOnce({
      rows: [
        { partition_name: 'delay_services_2024_01', partition_date: '2024-01-01' },
        { partition_name: 'delay_services_2024_02', partition_date: '2024-02-01' },
        { partition_name: 'delay_service_stops_2024_01', partition_date: '2024-01-01' },
      ],
    });

    const result = await strategy.execute(policy, false);

    expect(mockDbClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      expect.any(Array)
    );
    expect(result.partitionsDropped.length).toBeGreaterThan(0);
  });

  it('should generate DROP PARTITION SQL for old partitions', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock old partition (90 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);
    const partitionName = `delay_services_${oldDate.getFullYear()}_${String(oldDate.getMonth() + 1).padStart(2, '0')}`;

    mockDbClient.query.mockResolvedValueOnce({
      rows: [
        { partition_name: partitionName, partition_date: oldDate.toISOString().split('T')[0] },
      ],
    });

    mockDbClient.none.mockResolvedValue(undefined);

    const result = await strategy.execute(policy, false);

    expect(mockDbClient.none).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE'),
      expect.any(Array)
    );
    expect(result.partitionsDropped).toContain(partitionName);
  });

  it('should not drop partitions within retention period', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock recent partition (10 days ago - within retention)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);
    const partitionName = `delay_services_${recentDate.getFullYear()}_${String(recentDate.getMonth() + 1).padStart(2, '0')}`;

    mockDbClient.query.mockResolvedValueOnce({
      rows: [
        { partition_name: partitionName, partition_date: recentDate.toISOString().split('T')[0] },
      ],
    });

    const result = await strategy.execute(policy, false);

    expect(mockDbClient.none).not.toHaveBeenCalled();
    expect(result.partitionsDropped).toHaveLength(0);
  });

  it('should handle darwin_ingestor schema partitions', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.query.mockResolvedValueOnce({
      rows: [],
    });

    const result = await strategy.execute(policy, false);

    expect(mockDbClient.query).toHaveBeenCalledWith(
      expect.stringContaining('darwin_ingestor'),
      expect.any(Array)
    );
    expect(result.recordsDeleted).toBe(0);
  });

  it('should support dry run mode without executing DROP', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);
    const partitionName = `delay_services_${oldDate.getFullYear()}_${String(oldDate.getMonth() + 1).padStart(2, '0')}`;

    mockDbClient.query.mockResolvedValueOnce({
      rows: [
        { partition_name: partitionName, partition_date: oldDate.toISOString().split('T')[0] },
      ],
    });

    const result = await strategy.execute(policy, true); // dry run

    expect(mockDbClient.none).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.partitionsDropped).toContain(partitionName);
  });

  it('should return CleanupResult with correct structure', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.query.mockResolvedValueOnce({
      rows: [],
    });

    const result = await strategy.execute(policy, false);

    expect(result).toHaveProperty('recordsDeleted');
    expect(result).toHaveProperty('partitionsDropped');
    expect(result).toHaveProperty('gcsFilesDeleted');
    expect(result).toHaveProperty('dryRun');
    expect(Array.isArray(result.partitionsDropped)).toBe(true);
  });
});
