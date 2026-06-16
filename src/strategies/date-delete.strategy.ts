/**
 * DateDeleteStrategy
 *
 * Cleanup strategy for deleting old records based on date columns.
 *
 * Target schemas: timetable_loader, darwin_ingestor (outbox)
 * Strategy: DELETE WHERE date_column < cutoff_date
 *
 * Table configuration:
 *   - timetable_loader: DELETE FROM services WHERE service_date < cutoff
 *   - darwin_ingestor_outbox: DELETE FROM outbox_events WHERE published_at IS NOT NULL AND published_at < cutoff
 *
 * BL-346: outbox_events uses a safetyPredicate to ensure unpublished rows (published_at IS NULL)
 * are NEVER deleted regardless of age.
 *
 * Related: Notion › Technical Debt Register TD-DARWIN-003, BL-346
 */

import type { CleanupStrategy, CleanupResult, RetentionPolicy } from './cleanup-strategy.interface';
import { db } from '../database/client';

/**
 * DbClient interface used by DateDeleteStrategy.
 * The result() method returns the raw query result object with rows and rowCount.
 * Matches the shape injected by tests and the pool adapter used in production.
 */
export interface DbClient {
  result(sql: string, params?: unknown[]): Promise<{ rows?: Array<{ count: string }>; rowCount?: number | null }>;
}

interface TableConfig {
  schema: string;
  table: string;
  /** The column used in the age cutoff comparison (< cutoff). */
  dateColumn: string;
  /**
   * Optional predicate prepended before the dateColumn < $1 clause.
   * Use for safety guards such as `published_at IS NOT NULL` on outbox tables.
   * Must be a complete SQL predicate fragment (no trailing AND).
   */
  safetyPredicate?: string;
}

/**
 * Build the default production DB client adapter from the module-level singleton pool.
 * Wraps pool.query() to expose the result() interface expected by DateDeleteStrategy.
 */
function buildDefaultDbClient(): DbClient {
  return {
    async result(sql: string, params?: unknown[]) {
      const pool = db.getPool();
      return pool.query(sql, params as unknown[]);
    },
  };
}

export class DateDeleteStrategy implements CleanupStrategy {
  readonly name = 'DateDeleteStrategy';

  private readonly dbClient: DbClient;

  constructor(dbClient?: DbClient) {
    this.dbClient = dbClient ?? buildDefaultDbClient();
  }

  // Each schema can have multiple tables to clean, in order (child tables first)
  private tableConfigs: Map<string, TableConfig[]> = new Map([
    // timetable_loader: service_stops (2.5GB) references services, delete child first
    ['timetable_loader', [
      { schema: 'timetable_loader', table: 'service_stops', dateColumn: 'created_at' },
      { schema: 'timetable_loader', table: 'services', dateColumn: 'service_date' },
      { schema: 'timetable_loader', table: 'gtfs_generation_log', dateColumn: 'generation_date' },
      { schema: 'timetable_loader', table: 'gtfs_archives', dateColumn: 'generation_date' },
    ]],
    // darwin_ingestor_outbox: outbox_events table
    // BL-346: MUST only delete PUBLISHED rows (published_at IS NOT NULL).
    // The safetyPredicate guards against deleting unpublished events (data-loss prevention).
    ['darwin_ingestor_outbox', [
      {
        schema: 'darwin_ingestor',
        table: 'outbox_events',
        dateColumn: 'published_at',
        safetyPredicate: 'published_at IS NOT NULL',
      },
    ]],
  ]);

  async execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    const configs = this.tableConfigs.get(policy.target_schema);
    if (!configs || configs.length === 0) {
      throw new Error(`No table configuration found for schema: ${policy.target_schema}`);
    }

    let totalRecordsDeleted = 0;

    // Process each table in order (child tables first to avoid FK violations)
    for (const config of configs) {
      // Build the WHERE clause, prepending safetyPredicate if present.
      // dateColumn is not quoted so regex-based SQL assertions in tests can match unambiguously.
      const whereClause = config.safetyPredicate
        ? `${config.safetyPredicate} AND ${config.dateColumn} < $1`
        : `${config.dateColumn} < $1`;

      if (dryRun) {
        // Count records that would be deleted
        const countQuery = `SELECT COUNT(*) as count FROM "${config.schema}"."${config.table}" WHERE ${whereClause}`;
        const result = await this.dbClient.result(countQuery, [cutoffDate.toISOString()]);
        totalRecordsDeleted += parseInt(result.rows?.[0]?.count || '0', 10);
      } else {
        // Execute DELETE
        const deleteQuery = `DELETE FROM "${config.schema}"."${config.table}" WHERE ${whereClause}`;
        const result = await this.dbClient.result(deleteQuery, [cutoffDate.toISOString()]);
        totalRecordsDeleted += result.rowCount || 0;
      }
    }

    return {
      recordsDeleted: totalRecordsDeleted,
      partitionsDropped: [],
      gcsFilesDeleted: 0,
      dryRun,
    };
  }
}
