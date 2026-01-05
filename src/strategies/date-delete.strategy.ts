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

  private tableConfigs: Map<string, TableConfig> = new Map([
    ['timetable_loader', { schema: 'timetable_loader', table: 'services', dateColumn: 'service_date' }],
    ['darwin_ingestor_outbox', { schema: 'darwin_ingestor', table: 'outbox', dateColumn: 'published_at' }],
  ]);

  async execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    const config = this.tableConfigs.get(policy.target_schema);
    if (!config) {
      throw new Error(`No table configuration found for schema: ${policy.target_schema}`);
    }

    let recordsDeleted = 0;

    if (dryRun) {
      // Count records that would be deleted
      const countQuery = `
        SELECT COUNT(*) as count
        FROM "${config.schema}"."${config.table}"
        WHERE "${config.dateColumn}" < $1
      `;
      const rows = await db.query<CountRow>(countQuery, [cutoffDate.toISOString()]);
      recordsDeleted = parseInt(rows[0]?.count || '0', 10);
    } else {
      // Execute DELETE using pool for rowCount access
      const deleteQuery = `
        DELETE FROM "${config.schema}"."${config.table}"
        WHERE "${config.dateColumn}" < $1
      `;
      const pool = db.getPool();
      const result = await pool.query(deleteQuery, [cutoffDate.toISOString()]);
      recordsDeleted = result.rowCount || 0;
    }

    return {
      recordsDeleted,
      partitionsDropped: [],
      gcsFilesDeleted: 0,
      dryRun,
    };
  }
}
