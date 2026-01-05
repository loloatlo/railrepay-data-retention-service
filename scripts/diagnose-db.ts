/**
 * Diagnostic script to analyze database structure and find where data is stored
 */

import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres:IIIRjLuhvHSISUZqkErJSuiLJtiJfKFx@hopper.proxy.rlwy.net:14663/railway';

async function diagnose() {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // 1. List all schemas
    console.log('=== SCHEMAS ===');
    const schemas = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name
    `);
    schemas.rows.forEach(r => console.log(`  - ${r.schema_name}`));

    // 2. List all tables with sizes
    console.log('\n=== TABLES BY SIZE ===');
    const tables = await client.query(`
      SELECT
        schemaname || '.' || tablename as full_name,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size,
        pg_total_relation_size(schemaname || '.' || tablename) as size_bytes
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
      LIMIT 30
    `);
    tables.rows.forEach(r => console.log(`  ${r.full_name}: ${r.size}`));

    // 3. Database total size
    console.log('\n=== DATABASE SIZE ===');
    const dbSize = await client.query(`SELECT pg_size_pretty(pg_database_size('railway')) as size`);
    console.log(`  Total: ${dbSize.rows[0].size}`);

    // 4. Check for partitioned tables
    console.log('\n=== PARTITIONED TABLES ===');
    const partitions = await client.query(`
      SELECT
        schemaname,
        tablename
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        AND (tablename LIKE '%_20%' OR tablename ~ '_\\d{4}_\\d{2}$')
      ORDER BY schemaname, tablename
    `);
    if (partitions.rows.length === 0) {
      console.log('  No partitioned tables found');
    } else {
      partitions.rows.forEach(r => console.log(`  ${r.schemaname}.${r.tablename}`));
    }

    // 5. Check tables with date columns for retention
    console.log('\n=== TABLES WITH DATE COLUMNS (for retention) ===');
    const dateTables = await client.query(`
      SELECT
        table_schema || '.' || table_name as full_name,
        column_name
      FROM information_schema.columns
      WHERE column_name IN ('service_date', 'created_at', 'published_at', 'generation_date')
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    dateTables.rows.forEach(r => console.log(`  ${r.full_name} -> ${r.column_name}`));

    // 6. Row counts for large tables
    console.log('\n=== ROW COUNTS (estimated) ===');
    const rowCounts = await client.query(`
      SELECT
        schemaname || '.' || relname as full_name,
        n_live_tup as estimated_rows
      FROM pg_stat_user_tables
      WHERE n_live_tup > 1000
      ORDER BY n_live_tup DESC
      LIMIT 20
    `);
    rowCounts.rows.forEach(r => console.log(`  ${r.full_name}: ~${r.estimated_rows.toLocaleString()} rows`));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

diagnose();
