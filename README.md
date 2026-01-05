# Data Retention Service

Cross-schema operational service for automated data cleanup and retention policy enforcement.

## Architecture Compliance

- **ADR-001**: Schema-per-service pattern (`data_retention` schema)
- **ADR-002**: node-pg-migrate for all migrations
- **ADR-007**: Transactional outbox pattern for events
- **ADR-014**: TDD - tests written before implementation

## Schema Overview

### Tables

#### retention_policies
Defines cleanup policies for each target schema.

```sql
CREATE TABLE data_retention.retention_policies (
  id UUID PRIMARY KEY,
  target_schema VARCHAR(50) NOT NULL UNIQUE,
  retention_days INTEGER NOT NULL DEFAULT 31,
  cleanup_strategy VARCHAR(20) NOT NULL,  -- 'partition_drop', 'date_delete', 'gcs_cleanup'
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_cleanup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Initial Policies**:
- `darwin_ingestor`: 31 days, partition_drop strategy
- `darwin_ingestor_outbox`: 31 days, date_delete strategy
- `timetable_loader`: 31 days, date_delete strategy
- `gcs_gtfs_archive`: 31 days, gcs_cleanup strategy

#### cleanup_history
Audit trail of all cleanup operations.

```sql
CREATE TABLE data_retention.cleanup_history (
  id UUID PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES retention_policies(id),
  target_schema VARCHAR(50) NOT NULL,
  records_deleted BIGINT NOT NULL DEFAULT 0,
  partitions_dropped TEXT[],
  gcs_files_deleted INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL,  -- 'running', 'success', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### outbox
Standard transactional outbox per ADR-007.

```sql
CREATE TABLE data_retention.outbox (
  id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  published BOOLEAN NOT NULL DEFAULT false
);
```

## Cleanup Strategies

### partition_drop
Drops entire partitions for partitioned tables (fastest, minimal locks).

**Applicable to**: `darwin_ingestor.delay_services` (partitioned by service_date)

**Implementation**:
```sql
DROP TABLE darwin_ingestor.delay_services_20240101;
```

### date_delete
Deletes rows based on date column (flexible, works on any table).

**Applicable to**: `darwin_ingestor_outbox`, `timetable_loader` tables

**Implementation**:
```sql
DELETE FROM darwin_ingestor_outbox.outbox
WHERE created_at < NOW() - INTERVAL '31 days';
```

### gcs_cleanup
Deletes objects from GCS buckets using GCS client library.

**Applicable to**: `railrepay-gtfs-archive`, `railrepay-darwin-snapshots`

**Implementation**:
```typescript
await storage.bucket('railrepay-gtfs-archive')
  .deleteFiles({ prefix: '2024-01-01/' });
```

## Migration Commands

```bash
# Install dependencies
npm install

# Run migrations (up)
npm run migrate:up

# Rollback migrations (down)
npm run migrate:down

# Create new migration
npm run migrate:create <migration-name>
```

## Testing

Per ADR-014, all migrations have comprehensive integration tests using Testcontainers.

```bash
# Run all tests
npm test

# Run migration tests only
npm run test:migrations

# Watch mode (development)
npm run test:watch
```

## Environment Variables

See `.env.example` for required configuration.

## Events Published

The service publishes events via transactional outbox:

- `cleanup.started`: When cleanup operation begins
- `cleanup.completed`: When cleanup succeeds (includes stats)
- `cleanup.failed`: When cleanup fails (includes error)
- `policy.updated`: When retention policy is modified

## Operational Notes

### Cross-Schema Access

This service requires **elevated privileges** to:
- Query metadata from other schemas (e.g., partition names)
- Execute DROP TABLE on other schemas (partition_drop strategy)
- DELETE from other schemas (date_delete strategy)

**Database user**: `data_retention_service` with schema-specific grants.

### Monitoring

Key metrics to track:
- Cleanup execution duration
- Records deleted per run
- Partitions dropped per run
- GCS files deleted per run
- Cleanup failures (alert if > 0)

### Backup Considerations

Always take a database snapshot before:
- First cleanup run in production
- Changing retention_days to a lower value
- Enabling a previously disabled policy

## Phase 2 Deliverables

- [x] Service directory structure created
- [x] package.json with node-pg-migrate and test dependencies
- [x] tsconfig.json configured
- [x] Migration tests written (TDD RED phase)
- [x] Migration implemented (TDD GREEN phase)
- [x] Tests passing
- [x] README documentation

**Ready for Phase 3**: Blake can now implement service logic using this schema.
