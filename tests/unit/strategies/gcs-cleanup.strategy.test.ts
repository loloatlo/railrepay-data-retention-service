/**
 * GCSCleanupStrategy Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Target: railrepay-gtfs-archive bucket in Google Cloud Storage
 * Strategy: List files, filter by metadata.updated timestamp, delete old files
 * Retention: 31 days per Notion › Data Layer
 *
 * Related: Notion › Data Layer §GCS Object Storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';
import { GCSCleanupStrategy } from '../../../src/strategies/gcs-cleanup.strategy';

describe('GCSCleanupStrategy', () => {
  let strategy: GCSCleanupStrategy;
  let mockGCSClient: any;

  beforeEach(() => {
    mockGCSClient = {
      bucket: vi.fn().mockReturnThis(),
      getFiles: vi.fn(),
      file: vi.fn().mockReturnThis(),
      delete: vi.fn(),
    };
    strategy = new GCSCleanupStrategy(mockGCSClient);
  });

  it('should have name "GCSCleanupStrategy"', () => {
    expect(strategy.name).toBe('GCSCleanupStrategy');
  });

  it('should list GCS files older than retention period', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);

    // Mock GCS getFiles response
    const mockFileDelete = vi.fn().mockResolvedValue([{}]);
    mockGCSClient.bucket.mockReturnValue({
      getFiles: vi.fn().mockResolvedValue([
        [
          {
            name: 'gtfs_2024_01_15.zip',
            metadata: { updated: oldDate.toISOString() },
          },
        ],
      ]),
      file: vi.fn().mockReturnValue({
        delete: mockFileDelete,
      }),
    });

    const result = await strategy.execute(policy, false);

    expect(result.gcsFilesDeleted).toBe(1);
  });

  it('should delete old GCS files', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);

    const mockFileDelete = vi.fn().mockResolvedValue([{}]);

    mockGCSClient.bucket.mockReturnValue({
      getFiles: vi.fn().mockResolvedValue([
        [
          {
            name: 'old_file.zip',
            metadata: { updated: oldDate.toISOString() },
          },
        ],
      ]),
      file: vi.fn().mockReturnValue({
        delete: mockFileDelete,
      }),
    });

    const result = await strategy.execute(policy, false);

    expect(mockFileDelete).toHaveBeenCalled();
    expect(result.gcsFilesDeleted).toBe(1);
  });

  it('should return deleted file count', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);

    mockGCSClient.bucket.mockReturnValue({
      getFiles: vi.fn().mockResolvedValue([
        [
          { name: 'file1.zip', metadata: { updated: oldDate.toISOString() } },
          { name: 'file2.zip', metadata: { updated: oldDate.toISOString() } },
          { name: 'file3.zip', metadata: { updated: oldDate.toISOString() } },
        ],
      ]),
      file: vi.fn().mockReturnValue({
        delete: vi.fn().mockResolvedValue([{}]),
      }),
    });

    const result = await strategy.execute(policy, false);

    expect(result.gcsFilesDeleted).toBe(3);
    expect(result.recordsDeleted).toBe(0);
    expect(result.partitionsDropped).toHaveLength(0);
  });

  it('should support dry run mode without deleting files', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);

    const mockFileDelete = vi.fn();

    mockGCSClient.bucket.mockReturnValue({
      getFiles: vi.fn().mockResolvedValue([
        [
          { name: 'old_file.zip', metadata: { updated: oldDate.toISOString() } },
        ],
      ]),
      file: vi.fn().mockReturnValue({
        delete: mockFileDelete,
      }),
    });

    const result = await strategy.execute(policy, true);

    expect(mockFileDelete).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.gcsFilesDeleted).toBe(1); // Count only
  });

  it('should not delete files within retention period', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);

    mockGCSClient.bucket.mockReturnValue({
      getFiles: vi.fn().mockResolvedValue([
        [
          { name: 'recent_file.zip', metadata: { updated: recentDate.toISOString() } },
        ],
      ]),
    });

    const result = await strategy.execute(policy, false);

    expect(result.gcsFilesDeleted).toBe(0);
  });

  it('should target railrepay-gtfs-archive bucket', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'gcs_gtfs_archive',
      retention_days: 31,
      cleanup_strategy: 'gcs_cleanup',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockBucket = {
      getFiles: vi.fn().mockResolvedValue([[]]),
    };

    mockGCSClient.bucket.mockReturnValue(mockBucket);

    await strategy.execute(policy, false);

    expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-archive');
  });
});
