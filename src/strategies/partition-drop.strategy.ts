/**
 * PartitionDropStrategy
 *
 * Cleanup strategy for dropping old PostgreSQL partitions.
 *
 * Target schemas: darwin_ingestor
 * Target tables: delay_services, delay_service_stops (partitioned by service_date)
 * Strategy: Query pg_partitions, identify partitions older than retention period, execute DROP TABLE
 *
 * Partition naming convention: {table_name}_YYYY_MM
 * Example: delay_services_2024_01, delay_service_stops_2024_12
 *
 * Related: Notion › Data Layer §Table Partitioning
 */

import type { CleanupStrategy, CleanupResult, RetentionPolicy } from './cleanup-strategy.interface';
import { db } from '../database/client';

interface PartitionRow {
  partition_name: string;
  partition_date: string;
}

export class PartitionDropStrategy implements CleanupStrategy {
  readonly name = 'PartitionDropStrategy';

  async execute(policy: RetentionPolicy, dryRun: boolean): Promise<CleanupResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);

    // Query pg_partitions to find old partitions
    const partitions = await this.findOldPartitions(policy.target_schema, cutoffDate);

    const partitionsDropped: string[] = [];

    for (const partition of partitions) {
      if (!dryRun) {
        await this.dropPartition(policy.target_schema, partition.partition_name);
      }
      partitionsDropped.push(partition.partition_name);
    }

    return {
      recordsDeleted: 0, // Partition drops don't count individual records
      partitionsDropped,
      gcsFilesDeleted: 0,
      dryRun,
    };
  }

  private async findOldPartitions(schema: string, cutoffDate: Date): Promise<Array<{ partition_name: string; partition_date: string }>> {
    // Query PostgreSQL partition metadata
    // pg_partitions is a view that contains partition information
    const query = `
      SELECT
        tablename AS partition_name,
        -- Extract date from partition name (format: table_YYYY_MM)
        -- For darwin_ingestor partitions like delay_services_2024_01
        -- regexp_match returns array of capture groups
        (regexp_match(tablename, '_(\\d{4})_(\\d{2})$'))[1] || '-' ||
        (regexp_match(tablename, '_(\\d{4})_(\\d{2})$'))[2] || '-01' AS partition_date
      FROM pg_tables
      WHERE schemaname = $1
        AND (
          tablename LIKE 'delay_services_%'
          OR tablename LIKE 'delay_service_stops_%'
        )
        AND tablename ~ '_\\d{4}_\\d{2}$'
    `;

    const rows = await db.query<PartitionRow>(query, [schema]);

    // Filter partitions older than cutoff date
    return rows.filter((row) => {
      const partitionDate = new Date(row.partition_date);
      return partitionDate < cutoffDate;
    });
  }

  private async dropPartition(schema: string, partitionName: string): Promise<void> {
    // Use identifier quoting for safety (schema.tablename)
    // CASCADE drops dependent objects (indexes, etc.)
    const query = `DROP TABLE IF EXISTS "${schema}"."${partitionName}" CASCADE`;
    await db.query(query);
  }
}
