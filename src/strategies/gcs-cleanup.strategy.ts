/**
 * GCSCleanupStrategy
 *
 * Cleanup strategy for deleting old files from Google Cloud Storage.
 *
 * Target: Bucket configured via GCS_GTFS_BUCKET env var (default: railrepay-gtfs-prod).
 *         DR-PlatInfra-001: single canonical bucket is railrepay-gtfs-prod.
 * Strategy: List files, filter by filename pattern (gtfs-YYYY-MM-DD.zip only),
 *           then filter by metadata.updated timestamp, delete old files.
 * Retention: Configured via retention_days (default 31 days)
 *
 * Related: Notion › Data Layer §GCS Object Storage
 *          BL-95 (TD-OPSAUTO-005): https://www.notion.so/300815ba72ee8137a930dde469e3dd2a
 *          DR-PlatInfra-001: https://www.notion.so/33d815ba72ee810d9527ebd8bfd51c88
 */

import type { CleanupStrategy, CleanupResult, RetentionPolicy } from './cleanup-strategy.interface';

/** Only dated archive files are eligible for deletion. gtfs-latest.zip and any
 *  other non-dated files are excluded by this pattern. */
const DATED_ARCHIVE_PATTERN = /^gtfs-\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.zip$/;

export class GCSCleanupStrategy implements CleanupStrategy {
  readonly name = 'GCSCleanupStrategy';

  private bucketName: string;

  constructor(private gcsClient: any) {
    this.bucketName = process.env['GCS_GTFS_BUCKET'] ?? 'railrepay-gtfs-prod';
  }

  async execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    const bucket = this.gcsClient.bucket(this.bucketName);
    const [files] = await bucket.getFiles();

    let filesDeleted = 0;

    for (const file of files) {
      // AC-3: Only process files matching the dated-archive pattern.
      // gtfs-latest.zip and any other non-dated files are never deleted.
      if (!DATED_ARCHIVE_PATTERN.test(file.name)) {
        continue;
      }

      const fileUpdated = new Date(file.metadata.updated);

      if (fileUpdated < cutoffDate) {
        if (!dryRun) {
          await bucket.file(file.name).delete();
        }
        filesDeleted++;
      }
    }

    return {
      recordsDeleted: 0,
      partitionsDropped: [],
      gcsFilesDeleted: filesDeleted,
      dryRun,
    };
  }
}
