/**
 * Initial schema migration for data-retention-service
 * Creates data_retention schema with retention_policies, cleanup_history, and outbox tables
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // Step 1: Create schema (REQUIRED per ADR-001)
  pgm.createSchema('data_retention', { ifNotExists: true });

  // Step 2: Enable UUID extension
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  // Table 1: retention_policies
  // Configures cleanup policies per target schema
  pgm.createTable(
    { schema: 'data_retention', name: 'retention_policies' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      target_schema: {
        type: 'varchar(50)',
        notNull: true,
        unique: true,
      },
      retention_days: {
        type: 'integer',
        notNull: true,
        default: 31,
      },
      cleanup_strategy: {
        type: 'varchar(20)',
        notNull: true,
        check: "cleanup_strategy IN ('partition_drop', 'date_delete', 'gcs_cleanup')",
      },
      enabled: {
        type: 'boolean',
        notNull: true,
        default: true,
      },
      last_cleanup_at: {
        type: 'timestamptz',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    }
  );

  // Table 2: cleanup_history
  // Audit trail of all cleanup operations
  pgm.createTable(
    { schema: 'data_retention', name: 'cleanup_history' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      policy_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'data_retention', name: 'retention_policies' },
        onDelete: 'CASCADE',
      },
      target_schema: {
        type: 'varchar(50)',
        notNull: true,
      },
      records_deleted: {
        type: 'bigint',
        notNull: true,
        default: 0,
      },
      partitions_dropped: {
        type: 'text[]',
      },
      gcs_files_deleted: {
        type: 'integer',
        default: 0,
      },
      started_at: {
        type: 'timestamptz',
        notNull: true,
      },
      completed_at: {
        type: 'timestamptz',
      },
      status: {
        type: 'varchar(20)',
        notNull: true,
        check: "status IN ('running', 'success', 'failed')",
      },
      error_message: {
        type: 'text',
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
    }
  );

  // Create indexes on cleanup_history
  pgm.createIndex({ schema: 'data_retention', name: 'cleanup_history' }, 'policy_id');
  pgm.createIndex({ schema: 'data_retention', name: 'cleanup_history' }, 'target_schema');
  pgm.createIndex({ schema: 'data_retention', name: 'cleanup_history' }, ['started_at', 'status']);

  // Table 3: outbox (transactional outbox pattern per ADR-007)
  pgm.createTable(
    { schema: 'data_retention', name: 'outbox' },
    {
      id: {
        type: 'uuid',
        primaryKey: true,
        default: pgm.func('gen_random_uuid()'),
      },
      aggregate_id: {
        type: 'uuid',
        notNull: true,
      },
      aggregate_type: {
        type: 'varchar(100)',
        notNull: true,
      },
      event_type: {
        type: 'varchar(100)',
        notNull: true,
      },
      payload: {
        type: 'jsonb',
        notNull: true,
      },
      correlation_id: {
        type: 'uuid',
        notNull: true,
      },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('NOW()'),
      },
      published_at: {
        type: 'timestamptz',
      },
      published: {
        type: 'boolean',
        notNull: true,
        default: false,
      },
    }
  );

  // Create partial index for unpublished events (performance optimization)
  pgm.createIndex(
    { schema: 'data_retention', name: 'outbox' },
    ['created_at'],
    {
      name: 'idx_outbox_unpublished',
      where: 'published = false',
    }
  );

  // Seed initial retention policies
  pgm.sql(`
    INSERT INTO data_retention.retention_policies (target_schema, retention_days, cleanup_strategy, enabled)
    VALUES
      ('darwin_ingestor', 31, 'partition_drop', true),
      ('darwin_ingestor_outbox', 31, 'date_delete', true),
      ('timetable_loader', 31, 'date_delete', true),
      ('gcs_gtfs_archive', 31, 'gcs_cleanup', true)
    ON CONFLICT (target_schema) DO NOTHING;
  `);

  // Create trigger to update updated_at columns
  pgm.createFunction(
    { schema: 'data_retention', name: 'update_updated_at_column' },
    [],
    {
      returns: 'TRIGGER',
      language: 'plpgsql',
      replace: true,
    },
    `
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    `
  );

  // Add trigger for retention_policies
  pgm.createTrigger(
    { schema: 'data_retention', name: 'retention_policies' },
    'update_retention_policies_updated_at',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      function: { schema: 'data_retention', name: 'update_updated_at_column' },
      level: 'ROW',
    }
  );
};

exports.down = async (pgm) => {
  // Drop tables in reverse order
  pgm.dropTable({ schema: 'data_retention', name: 'outbox' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'data_retention', name: 'cleanup_history' }, { ifExists: true, cascade: true });
  pgm.dropTable({ schema: 'data_retention', name: 'retention_policies' }, { ifExists: true, cascade: true });

  // Drop function
  pgm.dropFunction(
    { schema: 'data_retention', name: 'update_updated_at_column' },
    [],
    { ifExists: true, cascade: true }
  );

  // Drop schema
  pgm.dropSchema('data_retention', { ifExists: true, cascade: true });
};
