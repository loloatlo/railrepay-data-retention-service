/**
 * Run VACUUM FULL to reclaim disk space
 * WARNING: This locks tables during operation
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

async function vacuumFull() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Size before
    console.log('=== SIZE BEFORE VACUUM FULL ===');
    const beforeSize = await client.query(`
      SELECT
        schemaname || '.' || tablename as full_name,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
      FROM pg_tables
      WHERE schemaname || '.' || tablename IN (
        'timetable_loader.service_stops',
        'darwin_ingestor.outbox_events'
      )
      ORDER BY schemaname, tablename
    `);
    beforeSize.rows.forEach(r => console.log(`  ${r.full_name}: ${r.size}`));

    const totalBefore = await client.query(`SELECT pg_size_pretty(pg_database_size('railway')) as size`);
    console.log(`  Total: ${totalBefore.rows[0].size}`);

    // Run VACUUM FULL
    console.log('\n=== RUNNING VACUUM FULL (this will lock tables) ===');

    console.log('  VACUUM FULL darwin_ingestor.outbox_events...');
    await client.query('VACUUM FULL darwin_ingestor.outbox_events');
    console.log('  Done.');

    console.log('  VACUUM FULL timetable_loader.service_stops...');
    await client.query('VACUUM FULL timetable_loader.service_stops');
    console.log('  Done.');

    console.log('  VACUUM FULL timetable_loader.services...');
    await client.query('VACUUM FULL timetable_loader.services');
    console.log('  Done.');

    // Size after
    console.log('\n=== SIZE AFTER VACUUM FULL ===');
    const afterSize = await client.query(`
      SELECT
        schemaname || '.' || tablename as full_name,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
      FROM pg_tables
      WHERE schemaname || '.' || tablename IN (
        'timetable_loader.service_stops',
        'darwin_ingestor.outbox_events'
      )
      ORDER BY schemaname, tablename
    `);
    afterSize.rows.forEach(r => console.log(`  ${r.full_name}: ${r.size}`));

    const totalAfter = await client.query(`SELECT pg_size_pretty(pg_database_size('railway')) as size`);
    console.log(`  Total: ${totalAfter.rows[0].size}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

vacuumFull();
