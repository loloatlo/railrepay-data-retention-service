/**
 * BL-345: Darwin firehose — index lean-down + 32-day retention policy.
 *
 * Deliverable 1 — Index lean-down on darwin_ingestor schema:
 *   Drops 6 non-essential indexes from the parent tables delay_service_stops
 *   and delay_services. Because this schema uses Postgres declarative partitioning
 *   with indexes defined ON ONLY the parent table, dropping the parent index
 *   cascades automatically to all attached partition-local indexes. No per-partition
 *   DROP statements are needed.
 *
 *   Indexes DROPPED:
 *     delay_service_stops: idx_delay_service_stops_crs
 *                          idx_delay_service_stops_delay_minutes
 *                          idx_delay_service_stops_service_date
 *     delay_services:      idx_delay_services_last_updated
 *                          idx_delay_services_service_date
 *                          idx_delay_services_toc_code
 *
 *   Indexes KEPT:
 *     delay_service_stops: delay_service_stops_pkey  (PK)
 *                          idx_delay_service_stops_service_id  (FK join / cascade)
 *     delay_services:      delay_services_pkey  (PK)
 *                          delay_services_rid_service_date_key  (UNIQUE — UPSERT target)
 *                          idx_delay_services_rid  (RID lookup by delay-tracker)
 *
 *   CONCURRENTLY decision: plain DROP INDEX (not CONCURRENTLY) is used here because
 *   the parent tables carry no live rows (all rows are in child partitions). The DROP
 *   acquires only a brief metadata lock (milliseconds) and is safe in a transaction.
 *   CONCURRENTLY cannot run inside a transaction block and would break node-pg-migrate's
 *   transactional migration wrapper.
 *
 * Deliverable 2 — Retention policy for darwin_ingestor delay tables:
 *   Updates the existing (disabled) darwin_ingestor retention policy row:
 *     - strategy:  partition_drop  →  date_delete
 *     - days:      31              →  32
 *     - enabled:   false           →  true
 *
 *   NOTE: The DateDeleteStrategy.tableConfigs map in src/strategies/date-delete.strategy.ts
 *   must also be extended with a 'darwin_ingestor' entry (child table first) before the
 *   retention service will execute this policy. That application code change is owned by
 *   Blake in TD-2 alongside the ingester changes.
 *
 * Idempotency: DROP INDEX IF EXISTS and UPDATE to constant values are both safe to re-run.
 *
 * References: RFC-006, BL-345, ADR-003 (node-pg-migrate), ADR-001 (schema-per-service)
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // ============================================================
  // Deliverable 1: Drop excess indexes from delay_service_stops
  // Dropping on the parent cascades to all attached partitions.
  // ============================================================
  pgm.sql(`
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_service_stops_crs;
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_service_stops_delay_minutes;
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_service_stops_service_date;
  `);

  // ============================================================
  // Deliverable 1: Drop excess indexes from delay_services
  // ============================================================
  pgm.sql(`
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_services_last_updated;
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_services_service_date;
    DROP INDEX IF EXISTS darwin_ingestor.idx_delay_services_toc_code;
  `);

  // ============================================================
  // Deliverable 2: Update darwin_ingestor retention policy row
  // Changes the existing disabled partition_drop row to an active
  // date_delete policy at 32 days.
  // ============================================================
  pgm.sql(`
    UPDATE data_retention.retention_policies
    SET
        retention_days    = 32,
        cleanup_strategy  = 'date_delete',
        enabled           = true,
        updated_at        = NOW()
    WHERE target_schema = 'darwin_ingestor';
  `);
};

exports.down = async (pgm) => {
  // ============================================================
  // Rollback: Recreate the dropped indexes on parent tables.
  // Postgres will propagate to existing partitions at attach time,
  // but existing partitions already attached will NOT automatically
  // get the recreated index — a manual re-index per partition would
  // be needed for full rollback. For the purposes of this down
  // migration, re-creating on the parent is sufficient to restore
  // the schema definition.
  // ============================================================
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_delay_service_stops_crs
        ON darwin_ingestor.delay_service_stops (crs_code);

    CREATE INDEX IF NOT EXISTS idx_delay_service_stops_delay_minutes
        ON darwin_ingestor.delay_service_stops (delay_minutes);

    CREATE INDEX IF NOT EXISTS idx_delay_service_stops_service_date
        ON darwin_ingestor.delay_service_stops (service_date);

    CREATE INDEX IF NOT EXISTS idx_delay_services_last_updated
        ON darwin_ingestor.delay_services (last_updated);

    CREATE INDEX IF NOT EXISTS idx_delay_services_service_date
        ON darwin_ingestor.delay_services (service_date);

    CREATE INDEX IF NOT EXISTS idx_delay_services_toc_code
        ON darwin_ingestor.delay_services (toc_code);
  `);

  // ============================================================
  // Rollback: Revert retention policy to original state
  // ============================================================
  pgm.sql(`
    UPDATE data_retention.retention_policies
    SET
        retention_days    = 31,
        cleanup_strategy  = 'partition_drop',
        enabled           = false,
        updated_at        = NOW()
    WHERE target_schema = 'darwin_ingestor';
  `);
};
