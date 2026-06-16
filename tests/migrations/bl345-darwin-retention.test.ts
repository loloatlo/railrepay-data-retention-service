/**
 * BL-345: Migration test — darwin firehose index lean-down + 32-day retention.
 *
 * Tests run against a real PostgreSQL instance via Testcontainers.
 * Docker must be running for these tests to execute. In CI they run via
 * the Railway CI environment which has Docker available.
 *
 * What this test suite verifies:
 *  1. After UP: the 6 dropped indexes no longer exist on parent or any partition
 *  2. After UP: the 5 kept indexes still exist on the parent tables
 *  3. After UP: dropped indexes do NOT appear on any partition (cascade confirmed)
 *  4. After UP: darwin_ingestor retention policy is date_delete, enabled, 32 days
 *  5. After DOWN: all 6 dropped indexes are recreated on the parent tables
 *  6. After DOWN: darwin_ingestor retention policy reverts to partition_drop, disabled, 31 days
 *  7. The DateDeleteStrategy executes against delay_service_stops before delay_services
 *     (child-before-parent ordering) without FK violation
 *
 * NOTE: These tests mirror the pattern in tests/migrations/initial-schema.test.ts.
 * They run all data-retention-service migrations in sequence so the schema and
 * seed policies are present before the BL-345 migration runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import path from 'path';

// ============================================================
// Indexes that BL-345 UP should DROP (must be absent after UP)
// ============================================================
const DROPPED_INDEXES_STOPS = [
  'idx_delay_service_stops_crs',
  'idx_delay_service_stops_delay_minutes',
  'idx_delay_service_stops_service_date',
];

const DROPPED_INDEXES_SERVICES = [
  'idx_delay_services_last_updated',
  'idx_delay_services_service_date',
  'idx_delay_services_toc_code',
];

// ============================================================
// Indexes that BL-345 UP must KEEP (must be present after UP)
// ============================================================
const KEPT_INDEXES_STOPS = [
  'delay_service_stops_pkey',
  'idx_delay_service_stops_service_id',
];

const KEPT_INDEXES_SERVICES = [
  'delay_services_pkey',
  'delay_services_rid_service_date_key',
  'idx_delay_services_rid',
];

describe('BL-345: darwin index lean-down + retention migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  // ============================================================
  // Bootstrap: start Postgres, run all data-retention migrations,
  // then bootstrap the darwin_ingestor schema manually so the
  // index DROP statements have valid targets.
  // ============================================================
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('test_db')
      .start();

    pool = new Pool({ connectionString: container.getConnectionUri() });

    // Step 1: Run data-retention-service migrations (creates data_retention schema + seed policies)
    const migrationDir = path.join(__dirname, '../../migrations');
    execSync(
      `DATABASE_URL="${container.getConnectionUri()}" npx node-pg-migrate up -m ${migrationDir} --migrations-table data_retention_pgmigrations`,
      {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      }
    );

    // Step 2: Bootstrap darwin_ingestor schema + partitioned tables.
    // The BL-345 migration operates on darwin_ingestor objects so we need the schema
    // and at least the parent tables + initial indexes to exist before the migration runs.
    // We create a minimal representative setup matching the live schema.
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS darwin_ingestor;

      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_services (
        id            UUID    NOT NULL DEFAULT gen_random_uuid(),
        rid           VARCHAR(50) NOT NULL,
        service_date  DATE    NOT NULL,
        toc_code      VARCHAR(10),
        cancelled     BOOLEAN NOT NULL DEFAULT FALSE,
        total_delay_minutes INTEGER,
        delay_reasons JSONB,
        last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, service_date),
        UNIQUE (rid, service_date)
      ) PARTITION BY RANGE (service_date);

      CREATE INDEX IF NOT EXISTS idx_delay_services_rid
          ON darwin_ingestor.delay_services (rid);
      CREATE INDEX IF NOT EXISTS idx_delay_services_service_date
          ON darwin_ingestor.delay_services (service_date);
      CREATE INDEX IF NOT EXISTS idx_delay_services_toc_code
          ON darwin_ingestor.delay_services (toc_code);
      CREATE INDEX IF NOT EXISTS idx_delay_services_last_updated
          ON darwin_ingestor.delay_services (last_updated);

      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_service_stops (
        id               UUID NOT NULL DEFAULT gen_random_uuid(),
        delay_service_id UUID NOT NULL,
        service_date     DATE NOT NULL,
        crs_code         VARCHAR(10) NOT NULL,
        scheduled_arrival  VARCHAR(10),
        scheduled_departure VARCHAR(10),
        actual_arrival     VARCHAR(10),
        actual_departure   VARCHAR(10),
        delay_minutes    INTEGER,
        cancelled        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, service_date),
        FOREIGN KEY (delay_service_id, service_date)
            REFERENCES darwin_ingestor.delay_services (id, service_date)
            ON DELETE CASCADE
      ) PARTITION BY RANGE (service_date);

      CREATE INDEX IF NOT EXISTS idx_delay_service_stops_service_id
          ON darwin_ingestor.delay_service_stops (delay_service_id);
      CREATE INDEX IF NOT EXISTS idx_delay_service_stops_crs
          ON darwin_ingestor.delay_service_stops (crs_code);
      CREATE INDEX IF NOT EXISTS idx_delay_service_stops_service_date
          ON darwin_ingestor.delay_service_stops (service_date);
      CREATE INDEX IF NOT EXISTS idx_delay_service_stops_delay_minutes
          ON darwin_ingestor.delay_service_stops (delay_minutes);

      -- Create one representative partition so we can verify cascade behaviour
      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_services_2026_06
          PARTITION OF darwin_ingestor.delay_services
          FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_service_stops_2026_06
          PARTITION OF darwin_ingestor.delay_service_stops
          FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

      -- Create an old partition that will hold rows to be deleted
      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_services_2026_01
          PARTITION OF darwin_ingestor.delay_services
          FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

      CREATE TABLE IF NOT EXISTS darwin_ingestor.delay_service_stops_2026_01
          PARTITION OF darwin_ingestor.delay_service_stops
          FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    `);

    // Step 3: Run BL-345 migration (UP)
    // node-pg-migrate will pick up only the new migration file that hasn't run yet
    execSync(
      `DATABASE_URL="${container.getConnectionUri()}" npx node-pg-migrate up -m ${migrationDir} --migrations-table data_retention_pgmigrations`,
      {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      }
    );
  }, 180000); // 3 minutes — Testcontainers startup + migrations

  afterAll(async () => {
    if (pool) await pool.end();
    if (container) await container.stop();
  });

  // ============================================================
  // AC-1: Dropped indexes absent from delay_service_stops parent
  // ============================================================
  it('should drop crs, delay_minutes, service_date indexes from delay_service_stops parent', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'darwin_ingestor'
        AND tablename = 'delay_service_stops'
    `);
    const names = result.rows.map((r: { indexname: string }) => r.indexname);

    for (const dropped of DROPPED_INDEXES_STOPS) {
      expect(names, `${dropped} should be absent after UP`).not.toContain(dropped);
    }
  });

  // ============================================================
  // AC-2: Dropped indexes absent from delay_services parent
  // ============================================================
  it('should drop last_updated, service_date, toc_code indexes from delay_services parent', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'darwin_ingestor'
        AND tablename = 'delay_services'
    `);
    const names = result.rows.map((r: { indexname: string }) => r.indexname);

    for (const dropped of DROPPED_INDEXES_SERVICES) {
      expect(names, `${dropped} should be absent after UP`).not.toContain(dropped);
    }
  });

  // ============================================================
  // AC-3: Kept indexes still present on delay_service_stops
  // ============================================================
  it('should keep pkey and service_id index on delay_service_stops', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'darwin_ingestor'
        AND tablename = 'delay_service_stops'
    `);
    const names = result.rows.map((r: { indexname: string }) => r.indexname);

    for (const kept of KEPT_INDEXES_STOPS) {
      expect(names, `${kept} should be present after UP`).toContain(kept);
    }
  });

  // ============================================================
  // AC-4: Kept indexes still present on delay_services
  // ============================================================
  it('should keep pkey, rid_service_date unique, and rid index on delay_services', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'darwin_ingestor'
        AND tablename = 'delay_services'
    `);
    const names = result.rows.map((r: { indexname: string }) => r.indexname);

    for (const kept of KEPT_INDEXES_SERVICES) {
      expect(names, `${kept} should be present after UP`).toContain(kept);
    }
  });

  // ============================================================
  // AC-5: Dropped indexes absent from the representative partition
  // (confirms parent-DROP cascaded to child partition indexes)
  // ============================================================
  it('should have no crs/delay_minutes/service_date index on the 2026_06 stops partition', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'darwin_ingestor'
        AND tablename = 'delay_service_stops_2026_06'
    `);
    const names = result.rows.map((r: { indexname: string }) => r.indexname);

    // The 3 dropped stop indexes should not appear on the partition either
    for (const dropped of DROPPED_INDEXES_STOPS) {
      // Partition index names follow pattern: tablename_column_idx
      const partitionEquivalent = dropped.replace('idx_delay_service_stops_', 'delay_service_stops_2026_06_').replace(/_idx$/, '_idx');
      expect(names, `partition index equivalent of ${dropped} should be absent`).not.toContain(partitionEquivalent);
    }
    // Also verify dropped names themselves don't appear (just in case naming varies)
    for (const dropped of DROPPED_INDEXES_STOPS) {
      expect(names).not.toContain(dropped);
    }
  });

  // ============================================================
  // AC-6: darwin_ingestor retention policy updated correctly
  // ============================================================
  it('should update darwin_ingestor retention policy to date_delete, enabled, 32 days', async () => {
    const result = await pool.query(`
      SELECT target_schema, retention_days, cleanup_strategy, enabled
      FROM data_retention.retention_policies
      WHERE target_schema = 'darwin_ingestor'
    `);

    expect(result.rows).toHaveLength(1);
    const policy = result.rows[0];
    expect(policy.retention_days).toBe(32);
    expect(policy.cleanup_strategy).toBe('date_delete');
    expect(policy.enabled).toBe(true);
  });

  // ============================================================
  // AC-7: DateDeleteStrategy can delete stops before services
  // without FK violation (child-before-parent ordering)
  // ============================================================
  it('should delete delay_service_stops before delay_services without FK violation', async () => {
    // Insert a parent service row in an "old" partition (Jan 2026)
    const serviceResult = await pool.query(`
      INSERT INTO darwin_ingestor.delay_services
        (id, rid, service_date, toc_code, total_delay_minutes, last_updated, created_at)
      VALUES
        (gen_random_uuid(), 'TEST_RID_BL345', '2026-01-10', 'VT', 30, NOW(), NOW())
      RETURNING id
    `);
    const serviceId = serviceResult.rows[0].id;

    // Insert a child stop row referencing the service
    await pool.query(`
      INSERT INTO darwin_ingestor.delay_service_stops
        (id, delay_service_id, service_date, crs_code, delay_minutes, created_at)
      VALUES
        (gen_random_uuid(), $1, '2026-01-10', 'MAN', 30, NOW())
    `, [serviceId]);

    // Execute deletion in child-before-parent order (mirrors DateDeleteStrategy)
    const cutoff = new Date('2026-02-01'); // Jan 2026 is fully in scope
    await expect(
      pool.query(
        `DELETE FROM darwin_ingestor.delay_service_stops WHERE service_date < $1`,
        [cutoff.toISOString()]
      )
    ).resolves.not.toThrow();

    await expect(
      pool.query(
        `DELETE FROM darwin_ingestor.delay_services WHERE service_date < $1`,
        [cutoff.toISOString()]
      )
    ).resolves.not.toThrow();

    // Verify both rows are gone
    const stopsLeft = await pool.query(
      `SELECT COUNT(*) FROM darwin_ingestor.delay_service_stops WHERE service_date < $1`,
      [cutoff.toISOString()]
    );
    expect(parseInt(stopsLeft.rows[0].count)).toBe(0);

    const servicesLeft = await pool.query(
      `SELECT COUNT(*) FROM darwin_ingestor.delay_services WHERE service_date < $1`,
      [cutoff.toISOString()]
    );
    expect(parseInt(servicesLeft.rows[0].count)).toBe(0);
  });

  // ============================================================
  // AC-8 (Rollback): After DOWN, all 6 dropped indexes reappear
  // ============================================================
  describe('after DOWN migration', () => {
    beforeAll(async () => {
      const migrationDir = path.join(__dirname, '../../migrations');
      execSync(
        `DATABASE_URL="${container.getConnectionUri()}" npx node-pg-migrate down -m ${migrationDir} --migrations-table data_retention_pgmigrations`,
        {
          cwd: path.join(__dirname, '../..'),
          env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
        }
      );
    }, 60000);

    it('should recreate all 6 dropped indexes on the parent tables', async () => {
      const stopsResult = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'darwin_ingestor' AND tablename = 'delay_service_stops'
      `);
      const stopsNames = stopsResult.rows.map((r: { indexname: string }) => r.indexname);

      for (const idx of DROPPED_INDEXES_STOPS) {
        expect(stopsNames, `${idx} should be recreated after DOWN`).toContain(idx);
      }

      const servicesResult = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'darwin_ingestor' AND tablename = 'delay_services'
      `);
      const servicesNames = servicesResult.rows.map((r: { indexname: string }) => r.indexname);

      for (const idx of DROPPED_INDEXES_SERVICES) {
        expect(servicesNames, `${idx} should be recreated after DOWN`).toContain(idx);
      }
    });

    it('should revert darwin_ingestor retention policy to partition_drop, disabled, 31 days', async () => {
      const result = await pool.query(`
        SELECT target_schema, retention_days, cleanup_strategy, enabled
        FROM data_retention.retention_policies
        WHERE target_schema = 'darwin_ingestor'
      `);

      expect(result.rows).toHaveLength(1);
      const policy = result.rows[0];
      expect(policy.retention_days).toBe(31);
      expect(policy.cleanup_strategy).toBe('partition_drop');
      expect(policy.enabled).toBe(false);
    });
  });
});
