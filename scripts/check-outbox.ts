/**
 * Check outbox_events table structure and data
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

async function checkOutbox() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Check columns
    console.log('=== OUTBOX_EVENTS COLUMNS ===');
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'darwin_ingestor' AND table_name = 'outbox_events'
      ORDER BY ordinal_position
    `);
    columns.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`));

    // Check data sample
    console.log('\n=== OUTBOX_EVENTS SAMPLE ===');
    const sample = await client.query(`
      SELECT id, created_at, published_at
      FROM darwin_ingestor.outbox_events
      LIMIT 5
    `);
    sample.rows.forEach(r => console.log(r));

    // Check date ranges by created_at
    console.log('\n=== DATE RANGE BY CREATED_AT ===');
    const dateRange = await client.query(`
      SELECT
        MIN(created_at) as min_date,
        MAX(created_at) as max_date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '31 days') as older_than_31_days
      FROM darwin_ingestor.outbox_events
    `);
    const row = dateRange.rows[0];
    console.log(`  Min created_at: ${row.min_date}`);
    console.log(`  Max created_at: ${row.max_date}`);
    console.log(`  Total rows: ${parseInt(row.total).toLocaleString()}`);
    console.log(`  Older than 31 days: ${parseInt(row.older_than_31_days).toLocaleString()}`);

    // Check published_at column
    console.log('\n=== PUBLISHED_AT STATUS ===');
    const publishedStats = await client.query(`
      SELECT
        CASE WHEN published_at IS NULL THEN 'NOT PUBLISHED' ELSE 'PUBLISHED' END as status,
        COUNT(*) as count
      FROM darwin_ingestor.outbox_events
      GROUP BY CASE WHEN published_at IS NULL THEN 'NOT PUBLISHED' ELSE 'PUBLISHED' END
    `);
    publishedStats.rows.forEach(r => console.log(`  ${r.status}: ${parseInt(r.count).toLocaleString()}`));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkOutbox();
