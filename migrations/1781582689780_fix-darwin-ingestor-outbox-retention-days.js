/**
 * BL-346: Fix darwin_ingestor_outbox retention_days in existing prod row.
 *
 * The initial-schema migration seeds retention_days=7 for darwin_ingestor_outbox,
 * but uses ON CONFLICT DO NOTHING. Any pre-existing row (inserted before the seed
 * was corrected) retains the schema default of 31 days. This migration explicitly
 * UPDATEs the row to 7 so the outbox purge uses the correct 7-day cutoff.
 *
 * Idempotency: UPDATE to a constant value is safe to re-run; repeated runs are no-ops.
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.sql(`
    UPDATE data_retention.retention_policies
    SET retention_days = 7,
        updated_at = NOW()
    WHERE target_schema = 'darwin_ingestor_outbox';
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`
    UPDATE data_retention.retention_policies
    SET retention_days = 31,
        updated_at = NOW()
    WHERE target_schema = 'darwin_ingestor_outbox';
  `);
};
