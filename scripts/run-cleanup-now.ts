/**
 * Manually run cleanup against production database to verify fix
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

interface RetentionPolicy {
  id: string;
  target_schema: string;
  retention_days: number;
  cleanup_strategy: string;
  enabled: boolean;
}

interface TableConfig {
  schema: string;
  table: string;
  dateColumn: string;
}

const tableConfigs: Map<string, TableConfig[]> = new Map([
  ['timetable_loader', [
    { schema: 'timetable_loader', table: 'service_stops', dateColumn: 'created_at' },
    { schema: 'timetable_loader', table: 'services', dateColumn: 'service_date' },
    { schema: 'timetable_loader', table: 'gtfs_generation_log', dateColumn: 'generation_date' },
    { schema: 'timetable_loader', table: 'gtfs_archives', dateColumn: 'generation_date' },
  ]],
  // Use created_at because published_at is NULL for unpublished events
  ['darwin_ingestor_outbox', [
    { schema: 'darwin_ingestor', table: 'outbox_events', dateColumn: 'created_at' },
  ]],
]);

async function runCleanup() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Get enabled policies
    const policies = await client.query<RetentionPolicy>(`
      SELECT id, target_schema, retention_days, cleanup_strategy, enabled
      FROM data_retention.retention_policies
      WHERE enabled = true AND cleanup_strategy = 'date_delete'
    `);

    console.log(`Found ${policies.rows.length} enabled date_delete policies\n`);

    for (const policy of policies.rows) {
      console.log(`\n=== Processing: ${policy.target_schema} (${policy.retention_days} days) ===`);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);
      console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

      const configs = tableConfigs.get(policy.target_schema);
      if (!configs) {
        console.log(`  No table config found for ${policy.target_schema}`);
        continue;
      }

      let totalDeleted = 0;

      for (const config of configs) {
        // First count
        const countResult = await client.query(`
          SELECT COUNT(*) as count
          FROM "${config.schema}"."${config.table}"
          WHERE "${config.dateColumn}" < $1
        `, [cutoffDate.toISOString()]);
        const toDelete = parseInt(countResult.rows[0].count, 10);
        console.log(`  ${config.schema}.${config.table}: ${toDelete.toLocaleString()} records to delete`);

        if (toDelete > 0) {
          // Execute delete
          const deleteResult = await client.query(`
            DELETE FROM "${config.schema}"."${config.table}"
            WHERE "${config.dateColumn}" < $1
          `, [cutoffDate.toISOString()]);
          console.log(`  -> Deleted ${deleteResult.rowCount?.toLocaleString()} records`);
          totalDeleted += deleteResult.rowCount || 0;
        }
      }

      // Record in cleanup_history
      await client.query(`
        INSERT INTO data_retention.cleanup_history
        (policy_id, target_schema, records_deleted, started_at, completed_at, status)
        VALUES ($1, $2, $3, NOW(), NOW(), 'success')
      `, [policy.id, policy.target_schema, totalDeleted]);

      // Update last_cleanup_at
      await client.query(`
        UPDATE data_retention.retention_policies
        SET last_cleanup_at = NOW()
        WHERE id = $1
      `, [policy.id]);

      console.log(`  Total deleted for ${policy.target_schema}: ${totalDeleted.toLocaleString()}`);
    }

    // Show final database size
    console.log('\n=== DATABASE SIZE AFTER CLEANUP ===');
    const sizeResult = await client.query(`
      SELECT
        schemaname || '.' || tablename as full_name,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
      LIMIT 10
    `);
    sizeResult.rows.forEach(r => console.log(`  ${r.full_name}: ${r.size}`));

    const totalSize = await client.query(`SELECT pg_size_pretty(pg_database_size('railway')) as size`);
    console.log(`\nTotal database size: ${totalSize.rows[0].size}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

runCleanup();
