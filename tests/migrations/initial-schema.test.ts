import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import path from 'path';

describe('data_retention schema migrations', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    // Start PostgreSQL container
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test_db')
      .start();

    // Create connection pool
    pool = new Pool({
      connectionString: container.getConnectionUri(),
    });

    // Run migrations
    const migrationDir = path.join(__dirname, '../../migrations');
    execSync(`DATABASE_URL="${container.getConnectionUri()}" npx node-pg-migrate up -m ${migrationDir}`, {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  it('should create data_retention schema', async () => {
    const result = await pool.query(`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = 'data_retention'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('should create retention_policies table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'data_retention' AND table_name = 'retention_policies'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('target_schema');
    expect(columns).toContain('retention_days');
    expect(columns).toContain('cleanup_strategy');
    expect(columns).toContain('enabled');
    expect(columns).toContain('last_cleanup_at');
    expect(columns).toContain('created_at');
    expect(columns).toContain('updated_at');
  });

  it('should have unique constraint on target_schema', async () => {
    const result = await pool.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'data_retention'
        AND table_name = 'retention_policies'
        AND constraint_type = 'UNIQUE'
    `);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('should create cleanup_history table with FK to policies', async () => {
    const result = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'data_retention'
        AND tc.table_name = 'cleanup_history'
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].column_name).toBe('policy_id');
    expect(result.rows[0].foreign_table_name).toBe('retention_policies');
  });

  it('should create cleanup_history table with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'data_retention' AND table_name = 'cleanup_history'
    `);

    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('policy_id');
    expect(columns).toContain('target_schema');
    expect(columns).toContain('records_deleted');
    expect(columns).toContain('partitions_dropped');
    expect(columns).toContain('gcs_files_deleted');
    expect(columns).toContain('started_at');
    expect(columns).toContain('completed_at');
    expect(columns).toContain('status');
    expect(columns).toContain('error_message');
  });

  it('should create outbox table per standard pattern', async () => {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'data_retention' AND table_name = 'outbox'
    `);

    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('aggregate_id');
    expect(columns).toContain('aggregate_type');
    expect(columns).toContain('event_type');
    expect(columns).toContain('payload');
    expect(columns).toContain('correlation_id');
    expect(columns).toContain('published');
    expect(columns).toContain('published_at');
  });

  it('should seed initial retention policies', async () => {
    const result = await pool.query(`
      SELECT target_schema, retention_days, cleanup_strategy
      FROM data_retention.retention_policies
      ORDER BY target_schema
    `);

    expect(result.rows).toHaveLength(4);
    
    const darwin = result.rows.find((r) => r.target_schema === 'darwin_ingestor');
    expect(darwin).toBeDefined();
    expect(darwin.retention_days).toBe(31);
    expect(darwin.cleanup_strategy).toBe('partition_drop');

    const timetable = result.rows.find((r) => r.target_schema === 'timetable_loader');
    expect(timetable).toBeDefined();
    expect(timetable.retention_days).toBe(31);
    expect(timetable.cleanup_strategy).toBe('date_delete');

    const gcs = result.rows.find((r) => r.target_schema === 'gcs_gtfs_archive');
    expect(gcs).toBeDefined();
    expect(gcs.cleanup_strategy).toBe('gcs_cleanup');
  });

  it('should have indexes on cleanup_history', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'data_retention' AND tablename = 'cleanup_history'
    `);

    const indexNames = result.rows.map((r) => r.indexname);
    expect(indexNames.length).toBeGreaterThanOrEqual(2); // At least policy_id and target_schema indexes
  });

  it('should have partial index on outbox for unpublished events', async () => {
    const result = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'data_retention' AND tablename = 'outbox'
    `);

    const unpublishedIndex = result.rows.find((r) => 
      r.indexdef.toLowerCase().includes('published = false')
    );
    expect(unpublishedIndex).toBeDefined();
  });

  it('should enforce check constraint on cleanup_strategy', async () => {
    await expect(
      pool.query(`
        INSERT INTO data_retention.retention_policies (target_schema, retention_days, cleanup_strategy)
        VALUES ('test_schema', 31, 'invalid_strategy')
      `)
    ).rejects.toThrow();
  });

  it('should enforce check constraint on status', async () => {
    // First get a valid policy_id
    const policyResult = await pool.query(`
      SELECT id FROM data_retention.retention_policies LIMIT 1
    `);

    await expect(
      pool.query(`
        INSERT INTO data_retention.cleanup_history (policy_id, target_schema, started_at, status)
        VALUES ($1, 'test', NOW(), 'invalid_status')
      `, [policyResult.rows[0].id])
    ).rejects.toThrow();
  });
});
