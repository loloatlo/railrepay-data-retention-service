/**
 * GCSCleanupStrategy
 *
 * Cleanup strategy for deleting old files from Google Cloud Storage.
 *
 * Target: railrepay-gtfs-archive bucket
 * Strategy: List files, filter by metadata.updated timestamp, delete old files
 * Retention: Configured via retention_days (default 31 days)
 *
 * Related: Notion › Data Layer §GCS Object Storage
 */

import type { CleanupStrategy, CleanupResult, RetentionPolicy } from './cleanup-strategy.interface';

export class GCSCleanupStrategy implements CleanupStrategy {
  readonly name = 'GCSCleanupStrategy';

  private bucketName = 'railrepay-gtfs-archive';

  constructor(private gcsClient: any) {}

  async execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    const bucket = this.gcsClient.bucket(this.bucketName);
    const [files] = await bucket.getFiles();

    let filesDeleted = 0;

    for (const file of files) {
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
