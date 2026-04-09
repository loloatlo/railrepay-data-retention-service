/**
 * GCSCleanupStrategy Unit Tests
 *
 * TD Context: BL-95 (TD-OPSAUTO-005) - GCS archive bucket mismatch.
 * The strategy hardcodes 'railrepay-gtfs-archive' but timetable-loader
 * uploads to 'railrepay-gtfs-prod'. Archives accumulate forever.
 *
 * DR-PlatInfra-001 approved: single bucket (railrepay-gtfs-prod),
 * data-retention-service update only (Option A).
 *
 * Required fix (Blake):
 *   - Accept bucket name via constructor arg OR env var GCS_GTFS_BUCKET
 *   - Default to 'railrepay-gtfs-prod' when env var not set
 *   - Filter files to ONLY match pattern gtfs-YYYY-MM-DD.zip before age check
 *   - Never delete gtfs-latest.zip regardless of age
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Reference: https://www.notion.so/300815ba72ee8137a930dde469e3dd2a (BL-95)
 *            https://www.notion.so/33d815ba72ee810d9527ebd8bfd51c88 (DR-PlatInfra-001)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';
import { GCSCleanupStrategy } from '../../../src/strategies/gcs-cleanup.strategy';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 'test-policy-id',
    target_schema: 'gcs_gtfs_archive',
    retention_days: 31,
    cleanup_strategy: 'gcs_cleanup',
    enabled: true,
    last_cleanup_at: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Build a dated archive filename that always matches the safe pattern. */
function datedFile(daysOld: number): { name: string; metadata: { updated: string } } {
  const d = new Date();
  d.setDate(d.getDate() - daysOld);
  const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return {
    name: `gtfs-${dateStr}.zip`,
    metadata: { updated: d.toISOString() },
  };
}

/** Build a mock GCS bucket that returns the given file list. */
function makeMockBucket(files: Array<{ name: string; metadata: { updated: string } }>) {
  const mockFileDelete = vi.fn().mockResolvedValue([{}]);
  return {
    mockBucket: {
      getFiles: vi.fn().mockResolvedValue([files]),
      file: vi.fn().mockReturnValue({ delete: mockFileDelete }),
    },
    mockFileDelete,
  };
}

// ---------------------------------------------------------------------------
// AC-2: Configurable bucket name via constructor / env var GCS_GTFS_BUCKET
// ---------------------------------------------------------------------------

describe('TD-OPSAUTO-005 / BL-95: GCSCleanupStrategy', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env after each test
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('AC-2: Configurable bucket name', () => {
    it('should use railrepay-gtfs-prod as the default bucket when GCS_GTFS_BUCKET is not set', async () => {
      // AC-2: Default bucket must be railrepay-gtfs-prod (not railrepay-gtfs-archive)
      delete process.env['GCS_GTFS_BUCKET'];

      const mockGCSClient = { bucket: vi.fn().mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[]]) }) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      await strategy.execute(makePolicy(), false);

      expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-prod');
    });

    it('should use the bucket name supplied via GCS_GTFS_BUCKET env var when set', async () => {
      // AC-2: When GCS_GTFS_BUCKET env var is present, that value must be used
      process.env['GCS_GTFS_BUCKET'] = 'railrepay-gtfs-staging';

      const mockGCSClient = { bucket: vi.fn().mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[]]) }) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      await strategy.execute(makePolicy(), false);

      expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-staging');
    });

    it('should NOT target railrepay-gtfs-archive (the wrong bucket)', async () => {
      // AC-2: The hardcoded wrong bucket must never be used when no env var is set
      delete process.env['GCS_GTFS_BUCKET'];

      const mockGCSClient = { bucket: vi.fn().mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[]]) }) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      await strategy.execute(makePolicy(), false);

      expect(mockGCSClient.bucket).not.toHaveBeenCalledWith('railrepay-gtfs-archive');
    });

    it('should prefer GCS_GTFS_BUCKET over the default when both could apply', async () => {
      // AC-2: Env var takes precedence; default only applies when env var absent
      process.env['GCS_GTFS_BUCKET'] = 'railrepay-gtfs-custom';

      const mockGCSClient = { bucket: vi.fn().mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[]]) }) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      await strategy.execute(makePolicy(), false);

      expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-custom');
      expect(mockGCSClient.bucket).not.toHaveBeenCalledWith('railrepay-gtfs-prod');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3: Filename-pattern safety filter (gtfs-YYYY-MM-DD.zip only)
  // ---------------------------------------------------------------------------

  describe('AC-3: Filename-pattern safety filter', () => {
    it('should skip gtfs-latest.zip regardless of how old it is', async () => {
      // AC-3: gtfs-latest.zip is the live symlink and must NEVER be deleted
      delete process.env['GCS_GTFS_BUCKET'];

      const veryOldDate = new Date('2000-01-01T00:00:00Z');
      const files = [
        { name: 'gtfs-latest.zip', metadata: { updated: veryOldDate.toISOString() } },
      ];
      const { mockBucket, mockFileDelete } = makeMockBucket(files);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.gcsFilesDeleted).toBe(0);
    });

    it('should skip files whose names do not match the gtfs-YYYY-MM-DD.zip pattern', async () => {
      // AC-3: Only files matching the exact dated-archive pattern are eligible
      delete process.env['GCS_GTFS_BUCKET'];

      const veryOldDate = new Date('2000-06-15T00:00:00Z');
      const nonPatternFiles = [
        { name: 'random-dump.zip',          metadata: { updated: veryOldDate.toISOString() } },
        { name: 'backup.tar.gz',            metadata: { updated: veryOldDate.toISOString() } },
        { name: 'gtfs_2024_01_15.zip',      metadata: { updated: veryOldDate.toISOString() } }, // underscores, not hyphens
        { name: 'gtfs-2024-13-01.zip',      metadata: { updated: veryOldDate.toISOString() } }, // month 13 — invalid date
        { name: 'GTFS-2024-01-15.zip',      metadata: { updated: veryOldDate.toISOString() } }, // uppercase prefix
        { name: 'gtfs-2024-01-15.tar',      metadata: { updated: veryOldDate.toISOString() } }, // wrong extension
        { name: 'prefix-gtfs-2024-01-15.zip', metadata: { updated: veryOldDate.toISOString() } }, // unexpected prefix
      ];
      const { mockBucket, mockFileDelete } = makeMockBucket(nonPatternFiles);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 1 }), false);

      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.gcsFilesDeleted).toBe(0);
    });

    it('should consider files matching gtfs-YYYY-MM-DD.zip as eligible candidates', async () => {
      // AC-3: A correctly named, sufficiently old archive must be treated as a deletion candidate
      delete process.env['GCS_GTFS_BUCKET'];

      const oldFile = datedFile(60); // 60 days old, outside 31-day retention
      const { mockBucket, mockFileDelete } = makeMockBucket([oldFile]);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).toHaveBeenCalledTimes(1);
      expect(result.gcsFilesDeleted).toBe(1);
    });

    it('should not delete gtfs-latest.zip even when a batch of old dated archives is deleted', async () => {
      // AC-3: Mixed list — latest must survive while old dated archives are removed
      delete process.env['GCS_GTFS_BUCKET'];

      const veryOldDate = new Date('2000-01-01T00:00:00Z');
      const files = [
        { name: 'gtfs-latest.zip',    metadata: { updated: veryOldDate.toISOString() } },
        { name: 'gtfs-2000-01-10.zip', metadata: { updated: veryOldDate.toISOString() } },
        { name: 'gtfs-2000-01-11.zip', metadata: { updated: veryOldDate.toISOString() } },
      ];
      const mockFileDelete = vi.fn().mockResolvedValue([{}]);
      const mockBucket = {
        getFiles: vi.fn().mockResolvedValue([files]),
        file: vi.fn().mockImplementation((name: string) => ({
          delete: name === 'gtfs-latest.zip'
            ? vi.fn().mockRejectedValue(new Error('latest must not be deleted'))
            : mockFileDelete,
        })),
      };
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      // Only the two dated archives should have been deleted
      expect(result.gcsFilesDeleted).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-4: Age-based deletion of dated archives
  // ---------------------------------------------------------------------------

  describe('AC-4: Age-based deletion', () => {
    it('should delete a dated archive that is older than retention_days', async () => {
      // AC-4: File outside retention window must be deleted
      delete process.env['GCS_GTFS_BUCKET'];

      const oldFile = datedFile(90); // 90 days > 31-day retention
      const { mockBucket, mockFileDelete } = makeMockBucket([oldFile]);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).toHaveBeenCalledTimes(1);
      expect(result.gcsFilesDeleted).toBe(1);
    });

    it('should keep a dated archive that is within the retention period', async () => {
      // AC-4: File inside retention window must NOT be deleted
      delete process.env['GCS_GTFS_BUCKET'];

      const recentFile = datedFile(10); // 10 days < 31-day retention
      const { mockBucket, mockFileDelete } = makeMockBucket([recentFile]);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.gcsFilesDeleted).toBe(0);
    });

    it('should return the correct count of deleted files without deleting in dry-run mode', async () => {
      // AC-4: Dry-run must count eligible files but not call delete
      delete process.env['GCS_GTFS_BUCKET'];

      const files = [
        datedFile(60),  // eligible — old
        datedFile(90),  // eligible — old
        datedFile(10),  // ineligible — recent
      ];
      const { mockBucket, mockFileDelete } = makeMockBucket(files);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), true);

      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.gcsFilesDeleted).toBe(2); // Count only, no actual deletion
    });

    it('should delete multiple old dated archives in one execution', async () => {
      // AC-4: All files outside retention must be removed in a single execute() call
      delete process.env['GCS_GTFS_BUCKET'];

      const files = [
        datedFile(32),  // just outside 31-day boundary
        datedFile(60),
        datedFile(365),
      ];
      const { mockBucket, mockFileDelete } = makeMockBucket(files);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).toHaveBeenCalledTimes(3);
      expect(result.gcsFilesDeleted).toBe(3);
    });

    it('should return zero when all dated archives are within the retention period', async () => {
      // AC-4: Nothing to delete → clean result
      delete process.env['GCS_GTFS_BUCKET'];

      const files = [datedFile(1), datedFile(5), datedFile(30)];
      const { mockBucket, mockFileDelete } = makeMockBucket(files);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.gcsFilesDeleted).toBe(0);
      expect(result.recordsDeleted).toBe(0);
      expect(result.partitionsDropped).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined behaviour: bucket + pattern filter + age filter together
  // ---------------------------------------------------------------------------

  describe('Combined behaviour: bucket, pattern filter, and age filter', () => {
    it('should target the configured bucket, apply the filename filter, AND apply the age filter together', async () => {
      // AC-2 + AC-3 + AC-4: All three behaviours must compose correctly
      process.env['GCS_GTFS_BUCKET'] = 'railrepay-gtfs-prod';

      const veryOldDate = new Date('2000-01-01T00:00:00Z');
      const recentDate  = new Date();
      recentDate.setDate(recentDate.getDate() - 5);

      const files = [
        // Eligible: correct pattern + old enough
        { name: 'gtfs-2000-01-10.zip', metadata: { updated: veryOldDate.toISOString() } },
        // Ineligible: protected filename
        { name: 'gtfs-latest.zip',     metadata: { updated: veryOldDate.toISOString() } },
        // Ineligible: wrong pattern
        { name: 'random-backup.zip',   metadata: { updated: veryOldDate.toISOString() } },
        // Ineligible: correct pattern but within retention
        { name: `gtfs-${recentDate.toISOString().slice(0, 10)}.zip`, metadata: { updated: recentDate.toISOString() } },
      ];

      const mockFileDelete = vi.fn().mockResolvedValue([{}]);
      const mockBucket = {
        getFiles: vi.fn().mockResolvedValue([files]),
        file: vi.fn().mockReturnValue({ delete: mockFileDelete }),
      };
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), false);

      // Bucket must be the one from env var
      expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-prod');
      // Only the one eligible file should be deleted
      expect(result.gcsFilesDeleted).toBe(1);
      expect(mockFileDelete).toHaveBeenCalledTimes(1);
    });

    it('should produce a correct dry-run result across bucket, pattern, and age rules', async () => {
      // AC-2 + AC-3 + AC-4: Dry-run with correct bucket and filtering
      delete process.env['GCS_GTFS_BUCKET'];

      const veryOldDate = new Date('2000-01-01T00:00:00Z');
      const files = [
        { name: 'gtfs-2000-06-01.zip', metadata: { updated: veryOldDate.toISOString() } }, // eligible
        { name: 'gtfs-2000-06-02.zip', metadata: { updated: veryOldDate.toISOString() } }, // eligible
        { name: 'gtfs-latest.zip',     metadata: { updated: veryOldDate.toISOString() } }, // ineligible — protected
        { name: 'other-file.tar',      metadata: { updated: veryOldDate.toISOString() } }, // ineligible — wrong pattern
      ];
      const { mockBucket, mockFileDelete } = makeMockBucket(files);
      const mockGCSClient = { bucket: vi.fn().mockReturnValue(mockBucket) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy({ retention_days: 31 }), true);

      // Bucket is the correct default
      expect(mockGCSClient.bucket).toHaveBeenCalledWith('railrepay-gtfs-prod');
      // No actual deletes in dry-run
      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      // Count reflects only the two eligible files
      expect(result.gcsFilesDeleted).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Retained baseline: name and CleanupResult shape
  // ---------------------------------------------------------------------------

  describe('Baseline interface contract', () => {
    it('should have name "GCSCleanupStrategy"', () => {
      const mockGCSClient = { bucket: vi.fn() };
      const strategy = new GCSCleanupStrategy(mockGCSClient);
      expect(strategy.name).toBe('GCSCleanupStrategy');
    });

    it('should return a CleanupResult with all required fields', async () => {
      delete process.env['GCS_GTFS_BUCKET'];

      const mockGCSClient = { bucket: vi.fn().mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[]]) }) };
      const strategy = new GCSCleanupStrategy(mockGCSClient);

      const result = await strategy.execute(makePolicy(), false);

      expect(result).toHaveProperty('recordsDeleted', 0);
      expect(result).toHaveProperty('partitionsDropped');
      expect(Array.isArray(result.partitionsDropped)).toBe(true);
      expect(result).toHaveProperty('gcsFilesDeleted');
      expect(result).toHaveProperty('dryRun', false);
    });
  });
});
