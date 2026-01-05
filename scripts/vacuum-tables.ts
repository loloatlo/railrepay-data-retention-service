/**
 * Run VACUUM on tables to reclaim disk space after DELETE operations
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

async function vacuumTables() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Check dead tuples before vacuum
    console.log('=== DEAD TUPLES BEFORE VACUUM ===');
    const deadTuples = await client.query(`
      SELECT
        schemaname || '.' || relname as table_name,
        n_dead_tup as dead_tuples,
        n_live_tup as live_tuples,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as size
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 0
      ORDER BY n_dead_tup DESC
      LIMIT 10
    `);
    deadTuples.rows.forEach(r => {
      console.log(`  ${r.table_name}: ${parseInt(r.dead_tuples).toLocaleString()} dead / ${parseInt(r.live_tuples).toLocaleString()} live (${r.size})`);
    });

    // Run VACUUM on the large tables
    console.log('\n=== RUNNING VACUUM ===');

    const tables = [
      'timetable_loader.service_stops',
      'timetable_loader.services',
      'darwin_ingestor.outbox_events'
    ];

    for (const table of tables) {
      console.log(`  Vacuuming ${table}...`);
      await client.query(`VACUUM ${table}`);
      console.log(`  Done.`);
    }

    // Check sizes after vacuum
    console.log('\n=== TABLE SIZES AFTER VACUUM ===');
    const sizes = await client.query(`
      SELECT
        schemaname || '.' || tablename as full_name,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
      FROM pg_tables
      WHERE schemaname || '.' || tablename IN (
        'timetable_loader.service_stops',
        'timetable_loader.services',
        'darwin_ingestor.outbox_events'
      )
      ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
    `);
    sizes.rows.forEach(r => console.log(`  ${r.full_name}: ${r.size}`));

    // Total database size
    const totalSize = await client.query(`SELECT pg_size_pretty(pg_database_size('railway')) as size`);
    console.log(`\nTotal database size: ${totalSize.rows[0].size}`);

    // Check date ranges
    console.log('\n=== DATA DATE RANGES ===');
    const serviceStopsDates = await client.query(`
      SELECT
        MIN(created_at) as min_created_at,
        MAX(created_at) as max_created_at,
        COUNT(*) as total_rows
      FROM timetable_loader.service_stops
    `);
    console.log(`  service_stops: ${serviceStopsDates.rows[0].total_rows.toLocaleString()} rows`);
    console.log(`    created_at: ${serviceStopsDates.rows[0].min_created_at} to ${serviceStopsDates.rows[0].max_created_at}`);

    const servicesDates = await client.query(`
      SELECT
        MIN(service_date) as min_service_date,
        MAX(service_date) as max_service_date,
        COUNT(*) as total_rows
      FROM timetable_loader.services
    `);
    console.log(`  services: ${servicesDates.rows[0].total_rows.toLocaleString()} rows`);
    console.log(`    service_date: ${servicesDates.rows[0].min_service_date} to ${servicesDates.rows[0].max_service_date}`);

    const outboxDates = await client.query(`
      SELECT
        MIN(published_at) as min_published_at,
        MAX(published_at) as max_published_at,
        COUNT(*) as total_rows
      FROM darwin_ingestor.outbox_events
    `);
    console.log(`  outbox_events: ${outboxDates.rows[0].total_rows.toLocaleString()} rows`);
    console.log(`    published_at: ${outboxDates.rows[0].min_published_at} to ${outboxDates.rows[0].max_published_at}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

vacuumTables();
