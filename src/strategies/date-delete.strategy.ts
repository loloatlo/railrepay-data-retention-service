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

interface TableConfig {
  schema: string;
  table: string;
  dateColumn: string;
}

export class DateDeleteStrategy implements CleanupStrategy {
  readonly name = 'DateDeleteStrategy';

  private tableConfigs: Map<string, TableConfig> = new Map([
    ['timetable_loader', { schema: 'timetable_loader', table: 'services', dateColumn: 'service_date' }],
    ['darwin_ingestor_outbox', { schema: 'darwin_ingestor', table: 'outbox', dateColumn: 'published_at' }],
  ]);

  constructor(private dbClient: any) {}

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
        FROM $1:name.$2:name
        WHERE $3:name < $4
      `;
      const result = await this.dbClient.result(countQuery, [
        config.schema,
        config.table,
        config.dateColumn,
        cutoffDate.toISOString(),
      ]);
      recordsDeleted = parseInt(result.rows[0].count, 10);
    } else {
      // Execute DELETE
      const deleteQuery = `
        DELETE FROM $1:name.$2:name
        WHERE $3:name < $4
      `;
      const result = await this.dbClient.result(deleteQuery, [
        config.schema,
        config.table,
        config.dateColumn,
        cutoffDate.toISOString(),
      ]);
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
