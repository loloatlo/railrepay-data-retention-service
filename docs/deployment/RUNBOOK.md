# Operational Runbook - Data Retention Service

**Service**: `data-retention-service`
**Type**: Railway Cron Job
**Schedule**: Daily at 03:00 UTC
**Owner**: DevOps (Moykle)

---

## Table of Contents

1. [Service Overview](#service-overview)
2. [Deployment Procedures](#deployment-procedures)
3. [Rollback Procedures](#rollback-procedures)
4. [Troubleshooting](#troubleshooting)
5. [Manual Operations](#manual-operations)
6. [Database Operations](#database-operations)
7. [Monitoring & Alerts](#monitoring--alerts)

---

## Service Overview

### Purpose

The `data-retention-service` is a cross-schema data retention cleanup service that:
- Deletes old records from multiple RailRepay services
- Drops old partitions to reclaim disk space
- Cleans up GCS archived files
- Records cleanup history for audit
- Publishes outbox events for downstream consumers

### Architecture

- **Deployment**: Railway Cron Job (NOT continuous service)
- **Schedule**: Daily at 03:00 UTC (`0 3 * * *`)
- **Database**: Shared PostgreSQL instance with `data_retention` schema (ADR-001)
- **Storage**: GCS buckets for archived file cleanup
- **Observability**: Grafana Cloud (metrics + logs via Alloy)

### Key Endpoints

- `GET /health` - Health check (only active when cron running)
- `GET /metrics` - Prometheus metrics

### Dependencies

- PostgreSQL (shared Railway instance)
- Redis (for idempotency keys)
- Google Cloud Storage (GCS) API
- Grafana Cloud (Alloy agent for metrics/logs)

---

## Deployment Procedures

### Standard Deployment Flow

```
1. Code push to main branch (GitHub)
   ↓
2. GitHub Actions CI/CD pipeline runs
   ↓
3. Railway auto-deploys on main branch push
   ↓
4. Smoke tests verify health endpoint
   ↓
5. Monitor first cron execution at 03:00 UTC
```

### Pre-Deployment Checklist

- [ ] All tests pass in CI (unit + integration)
- [ ] TypeScript builds successfully
- [ ] Security scan clean (no high/critical vulnerabilities)
- [ ] Database migrations reviewed and tested
- [ ] Grafana dashboard verified
- [ ] Rollback plan documented

### Deployment Steps

#### 1. Deploy via Git Push

```bash
cd data-retention-service
git add .
git commit -m "feat: <description>"
git push origin main
```

**Railway will auto-deploy** after GitHub Actions CI completes.

#### 2. Monitor Deployment

**Via Railway Dashboard**:
1. Navigate to Railway → data-retention-service
2. Go to "Deployments" tab
3. Monitor deployment status (Building → Deploying → Active)

**Via Railway CLI**:
```bash
railway status
```

#### 3. Verify Deployment

```bash
# Health check
curl https://<railway-service-url>/health

# Metrics
curl https://<railway-service-url>/metrics
```

#### 4. Monitor First Cron Execution

Wait for next scheduled run (03:00 UTC) and verify:
- Cron job completes successfully
- Cleanup history records created
- Grafana metrics flowing
- No errors in Loki logs

---

## Rollback Procedures

Per **ADR-005**, Railway native rollback is our safety mechanism.

### When to Rollback

**Immediate Rollback Required**:
- Cron job fails on execution
- Database errors during cleanup
- Critical records deleted unintentionally
- Health check fails consistently

**Monitor and Consider Rollback**:
- Performance degradation
- Increased error rate in logs
- Grafana alerts firing

### Rollback Steps

#### Step 1: Identify Previous Deployment

**Via Railway Dashboard**:
1. Go to Service → Deployments
2. Find last successful deployment (status: Active)
3. Note the deployment ID

**Via Railway MCP**:
```bash
# List recent deployments
railway list-deployments --limit=5 --json
```

#### Step 2: Execute Rollback

**Via Railway Dashboard**:
1. Click "..." on previous deployment
2. Select "Rollback to this deployment"
3. Confirm rollback

**Via Railway CLI**:
```bash
railway rollback
```

#### Step 3: Rollback Database Migration (if needed)

If the deployment included a migration:

```bash
railway run npm run migrate:down
```

**Verify migration rollback**:
```bash
railway run psql $DATABASE_URL -c "SELECT version FROM data_retention.pgmigrations ORDER BY run_on DESC LIMIT 1;"
```

#### Step 4: Restore Database Backup (if data loss occurred)

**CRITICAL**: Only if critical data was deleted.

1. Stop the cron job temporarily:
   - Railway Dashboard → Settings → Disable cron schedule

2. Restore from backup:
   ```bash
   # Railway automatic backups are used
   # Contact Railway support for restoration
   ```

3. Verify data restoration:
   ```bash
   railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM <affected_table>;"
   ```

4. Re-enable cron schedule

#### Step 5: Verify Rollback

- [ ] Health check returns 200
- [ ] Metrics flowing to Grafana
- [ ] Logs appearing in Loki
- [ ] Next cron execution succeeds

---

## Troubleshooting

### Cron Job Failed to Execute

**Symptoms**:
- Railway shows "Failed" status for last run
- No cleanup history records created
- Grafana alert: "Cron Job Failed"

**Diagnosis**:
```bash
# Check Railway logs
railway logs --filter="@level:error" --lines=100

# Check database connectivity
railway run npm run -- node -e "require('./dist/database/client').db.testConnection().then(console.log)"

# Verify environment variables
railway variables list
```

**Common Causes**:
1. Database connection timeout
   - **Fix**: Verify `DATABASE_URL` is correct
   - **Fix**: Check Railway PostgreSQL instance is running

2. GCS authentication failure
   - **Fix**: Verify `GCS_CREDENTIALS_BASE64` is valid
   - **Fix**: Re-encode GCS service account JSON

3. Out of memory
   - **Fix**: Increase Railway memory limit (Settings → Resources)

### Health Check Failing

**Symptoms**:
- Health endpoint returns 503 or timeout
- Railway shows "Unhealthy" status

**Diagnosis**:
```bash
# Test health endpoint
curl -v https://<railway-service-url>/health

# Check service logs
railway logs --lines=50
```

**Common Causes**:
1. Database connection pool exhausted
   - **Fix**: Restart service (Railway → Redeploy)

2. Service not running (cron job completed)
   - **Expected**: Health check only works when cron is actively running

### No Metrics Flowing to Grafana

**Symptoms**:
- Grafana dashboard shows no data
- Grafana alert: "No Metrics Flowing"

**Diagnosis**:
```bash
# Verify metrics endpoint
curl https://<railway-service-url>/metrics

# Check Alloy agent logs
railway logs --filter="alloy" --lines=50

# Verify environment variables
railway variables list | grep ALLOY_PUSH_URL
```

**Common Causes**:
1. `ALLOY_PUSH_URL` not set
   - **Fix**: Set environment variable in Railway

2. Alloy agent not running
   - **Fix**: Verify Grafana Alloy agent deployment on Railway

3. Network connectivity issue
   - **Fix**: Test connectivity to Grafana Cloud

### Database Migration Failed

**Symptoms**:
- Deployment fails during migration step
- Error: "Migration X failed"

**Diagnosis**:
```bash
# Check migration status
railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.pgmigrations ORDER BY run_on DESC LIMIT 5;"

# Check migration logs
railway logs --filter="migrate" --lines=100
```

**Recovery**:
```bash
# Rollback the failed migration
railway run npm run migrate:down

# Fix the migration script locally
# Test with Testcontainers
npm test tests/migrations/

# Redeploy with fixed migration
git push origin main
```

### Cleanup Deleted Too Much Data

**CRITICAL INCIDENT**: Immediate rollback required.

**Steps**:
1. Stop the cron job immediately:
   - Railway Dashboard → Settings → Disable cron schedule

2. Assess data loss:
   ```bash
   railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.cleanup_history ORDER BY completed_at DESC LIMIT 10;"
   ```

3. Contact Railway support for database backup restoration

4. After restoration, verify retention policy configuration:
   ```bash
   railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.retention_policies WHERE enabled = true;"
   ```

5. Review and fix retention days configuration

6. Re-enable cron schedule

---

## Manual Operations

### Manually Trigger Cleanup

**Use Case**: Testing, or running cleanup outside scheduled time.

```bash
# Dry run (no deletions)
railway run node dist/index.js --dry-run

# Execute cleanup immediately
railway run node dist/index.js
```

### Run Initial Cleanup

**Use Case**: First-time setup to clear historical data > 31 days.

```bash
railway run npm run cleanup:initial
```

### Disable a Retention Policy

```bash
railway run psql $DATABASE_URL -c "UPDATE data_retention.retention_policies SET enabled = false WHERE policy_id = '<policy_id>';"
```

### Add a New Retention Policy

```bash
railway run psql $DATABASE_URL -c "
INSERT INTO data_retention.retention_policies (
  target_schema,
  target_table,
  strategy_type,
  retention_days,
  enabled
) VALUES (
  'new_schema',
  'new_table',
  'DateDeleteStrategy',
  31,
  true
);
"
```

### Query Cleanup History

```bash
# Last 10 cleanups
railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.cleanup_history ORDER BY completed_at DESC LIMIT 10;"

# Cleanups for specific schema
railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.cleanup_history WHERE policy_id IN (SELECT policy_id FROM data_retention.retention_policies WHERE target_schema = 'darwin_ingestor');"
```

---

## Database Operations

### Run Migrations

```bash
# Apply all pending migrations
railway run npm run migrate:up

# Rollback last migration
railway run npm run migrate:down

# Check migration status
railway run psql $DATABASE_URL -c "SELECT * FROM data_retention.pgmigrations ORDER BY run_on DESC;"
```

### Database Backup

Railway provides automatic backups. For manual backup:

```bash
# Backup via Railway CLI
railway backup create

# List backups
railway backup list
```

### Schema Verification

```bash
# List all tables in data_retention schema
railway run psql $DATABASE_URL -c "\dt data_retention.*"

# Verify retention policies
railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM data_retention.retention_policies WHERE enabled = true;"
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `data_retention_cleanup_total` | Total cleanups executed | < 1 in 48 hours |
| `data_retention_records_deleted_total` | Total records deleted | Monitor for anomalies |
| `data_retention_partitions_dropped_total` | Total partitions dropped | Monitor for anomalies |
| `data_retention_errors_total` | Total errors during cleanup | > 5 in 1 hour |
| `data_retention_duration_seconds` | Cleanup duration | > 1800 seconds |

### Grafana Dashboards

**Dashboard**: `data-retention-service`

**Panels**:
1. Cleanup execution count (last 7 days)
2. Records deleted per cleanup
3. Partitions dropped per cleanup
4. Error rate
5. Cleanup duration

### Loki Log Queries

**Recent errors**:
```
{service="data-retention-service"} |= "error"
```

**Cleanup executions**:
```
{service="data-retention-service"} |= "CleanupOrchestrator: Starting cleanup"
```

**Database errors**:
```
{service="data-retention-service"} |= "PGXXX"
```

### Alerts

Configured in Grafana Cloud:

1. **Cron Job Failed** (High)
   - No successful cleanup in 48 hours
   - Action: Page on-call DevOps

2. **Database Errors** (High)
   - `data_retention_errors_total > 5` in 1 hour
   - Action: Alert DevOps Slack

3. **No Metrics Flowing** (Medium)
   - No metrics received in 2 hours
   - Action: Alert DevOps Slack

4. **Cleanup Duration** (Medium)
   - Cleanup takes > 30 minutes
   - Action: Investigate query performance

---

## Escalation

### Incident Response

| Severity | Response Time | Escalation |
|----------|---------------|------------|
| **Critical** (data loss, service down) | Immediate | Page on-call DevOps → CTO |
| **High** (cron failing, errors) | 1 hour | Alert DevOps Slack |
| **Medium** (performance degradation) | 4 hours | DevOps team review |
| **Low** (monitoring, logs) | Next business day | DevOps team review |

### Contact

- **DevOps On-Call**: Moykle
- **Slack Channel**: `#railrepay-devops`
- **Incident Tracker**: Notion › Incidents

---

**Last Updated**: 2026-01-05
**Owner**: Moykle (DevOps Engineer)
**Phase**: Phase 5 - Deployment
