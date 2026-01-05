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
 *   - darwin_ingestor_outbox: DELETE FROM outbox WHERE published_at < cutoff
 *
 * Related: Notion › Technical Debt Register TD-DARWIN-003
 */

import type { CleanupStrategy, CleanupResult, RetentionPolicy } from './cleanup-strategy.interface';
import { db } from '../database/client';

interface TableConfig {
  schema: string;
  table: string;
  dateColumn: string;
}

interface CountRow {
  count: string;
}

export class DateDeleteStrategy implements CleanupStrategy {
  readonly name = 'DateDeleteStrategy';

  // Each schema can have multiple tables to clean, in order (child tables first)
  private tableConfigs: Map<string, TableConfig[]> = new Map([
    // timetable_loader: service_stops (2.5GB) references services, delete child first
    ['timetable_loader', [
      { schema: 'timetable_loader', table: 'service_stops', dateColumn: 'created_at' },
      { schema: 'timetable_loader', table: 'services', dateColumn: 'service_date' },
      { schema: 'timetable_loader', table: 'gtfs_generation_log', dateColumn: 'generation_date' },
      { schema: 'timetable_loader', table: 'gtfs_archives', dateColumn: 'generation_date' },
    ]],
    // darwin_ingestor_outbox: outbox_events table (NOT "outbox")
    // Use created_at because published_at is NULL for unpublished events
    ['darwin_ingestor_outbox', [
      { schema: 'darwin_ingestor', table: 'outbox_events', dateColumn: 'created_at' },
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
    const pool = db.getPool();

    // Process each table in order (child tables first to avoid FK violations)
    for (const config of configs) {
      if (dryRun) {
        // Count records that would be deleted
        const countQuery = `
          SELECT COUNT(*) as count
          FROM "${config.schema}"."${config.table}"
          WHERE "${config.dateColumn}" < $1
        `;
        const result = await pool.query<CountRow>(countQuery, [cutoffDate.toISOString()]);
        totalRecordsDeleted += parseInt(result.rows[0]?.count || '0', 10);
      } else {
        // Execute DELETE
        const deleteQuery = `
          DELETE FROM "${config.schema}"."${config.table}"
          WHERE "${config.dateColumn}" < $1
        `;
        const result = await pool.query(deleteQuery, [cutoffDate.toISOString()]);
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
