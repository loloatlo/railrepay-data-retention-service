/**
 * Cleanup Strategy Interface
 *
 * Defines the contract for data retention cleanup strategies.
 * Each strategy implements a specific cleanup approach (partition drop, date-based delete, GCS cleanup).
 *
 * Per ADR-014 (TDD): Interface defined to enable test-first development.
 */

export interface RetentionPolicy {
  id: string;
  target_schema: string;
  retention_days: number;
  cleanup_strategy: 'partition_drop' | 'date_delete' | 'gcs_cleanup';
  enabled: boolean;
  last_cleanup_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CleanupResult {
  recordsDeleted: number;
  partitionsDropped: string[];
  gcsFilesDeleted: number;
  dryRun: boolean;
}

export interface CleanupStrategy {
  readonly name: string;
  execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult>;
}
