/**
 * Fix retention policies to match actual database structure
 *
 * Issues found:
 * 1. darwin_ingestor uses partition_drop but tables are NOT partitioned (0 bytes)
 * 2. darwin_ingestor_outbox was looking for 'outbox' but table is 'outbox_events'
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

async function fixPolicies() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // 1. Disable darwin_ingestor partition_drop policy (no partitions exist)
    console.log('=== Disabling darwin_ingestor partition_drop policy ===');
    const result1 = await client.query(`
      UPDATE data_retention.retention_policies
      SET enabled = false, updated_at = NOW()
      WHERE target_schema = 'darwin_ingestor'
        AND cleanup_strategy = 'partition_drop'
      RETURNING target_schema, cleanup_strategy, enabled
    `);
    console.log('Updated:', result1.rows);

    // 2. Disable gcs_gtfs_archive policy (bucket doesn't exist)
    console.log('\n=== Disabling gcs_gtfs_archive policy (bucket not configured) ===');
    const result2 = await client.query(`
      UPDATE data_retention.retention_policies
      SET enabled = false, updated_at = NOW()
      WHERE target_schema = 'gcs_gtfs_archive'
      RETURNING target_schema, cleanup_strategy, enabled
    `);
    console.log('Updated:', result2.rows);

    // 3. Show current policies
    console.log('\n=== Current Retention Policies ===');
    const policies = await client.query(`
      SELECT target_schema, retention_days, cleanup_strategy, enabled, last_cleanup_at
      FROM data_retention.retention_policies
      ORDER BY target_schema
    `);
    policies.rows.forEach(r => {
      console.log(`  ${r.target_schema}: ${r.cleanup_strategy} (${r.retention_days} days) - ${r.enabled ? 'ENABLED' : 'DISABLED'}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

fixPolicies();
