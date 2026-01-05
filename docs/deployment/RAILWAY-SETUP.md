# Railway Setup - Data Retention Service

**Service**: `data-retention-service`
**Type**: Cron Job (NOT continuous web service)
**Schedule**: Daily at 03:00 UTC (`0 3 * * *`)
**Owner**: DevOps (Moykle)

---

## Prerequisites

1. GitHub repository created: `railrepay-data-retention-service`
2. Code pushed to `main` branch
3. Railway account with project access
4. PostgreSQL instance provisioned (shared RailRepay instance)
5. Grafana Cloud account configured

---

## One-Time Railway Service Setup

### Step 1: Create Railway Service

1. Navigate to Railway dashboard
2. Select RailRepay project
3. Click "New Service"
4. Select "GitHub Repo"
5. Connect to `railrepay-data-retention-service`
6. Configure deployment settings:
   - **Name**: `data-retention-service`
   - **Branch**: `main`
   - **Auto-deploy**: Enabled

### Step 2: Configure Service Type

**CRITICAL**: This is a CRON JOB, not a web service.

1. Go to Service Settings
2. Under "Service Type", select **Cron Job**
3. Set schedule: `0 3 * * *` (03:00 UTC daily)
4. Confirm cron expression is valid

### Step 3: Set Environment Variables

See `ENVIRONMENT-VARIABLES.md` for complete list. Required variables:

```bash
# Service Identity
SERVICE_NAME=data-retention-service
DATABASE_SCHEMA=data_retention
PORT=3000
NODE_ENV=production

# PostgreSQL (Railway)
DATABASE_URL=<Railway PostgreSQL connection string>
PGHOST=<Railway PostgreSQL internal hostname>
PGPORT=5432
PGDATABASE=railway
PGUSER=postgres
PGPASSWORD=<Railway PostgreSQL password>
PGSSLMODE=require

# GCS (Google Cloud Storage)
GCS_CREDENTIALS_BASE64=<Base64-encoded GCS service account JSON>
GCS_GTFS_ARCHIVE_BUCKET=railrepay-gtfs-archive

# Observability (Grafana Cloud)
ALLOY_PUSH_URL=<Grafana Alloy push URL>
LOKI_BASIC_AUTH=<Loki basic auth credentials>
LOG_LEVEL=info

# Retention Configuration
DEFAULT_RETENTION_DAYS=31
```

**How to set variables in Railway**:
1. Go to Service Settings → Variables
2. Add each variable individually
3. Click "Add" for each entry
4. Railway will redeploy automatically after variable changes

### Step 4: Configure Health Check

Even though this is a cron job, we expose a health endpoint for verification.

1. Go to Service Settings → Health Check
2. Set **Path**: `/health`
3. Set **Port**: `3000`
4. Set **Timeout**: `30 seconds`
5. Set **Interval**: `60 seconds`

**Note**: The health check will only be active when the cron job is running.

### Step 5: Configure Build Settings

Railway auto-detects the Dockerfile. Verify:

1. Go to Service Settings → Build
2. Confirm **Dockerfile** is detected
3. Build command: (auto-detected from Dockerfile)
4. Start command: `node dist/index.js` (from Dockerfile CMD)

### Step 6: Configure Resource Limits

Set appropriate resource limits for a cron job:

1. Go to Service Settings → Resources
2. Set **Memory**: `512 MB` (cron job, not high memory usage)
3. Set **CPU**: `0.5 vCPU`
4. Set **Timeout**: `3600 seconds` (1 hour max runtime)

---

## Database Migration

Before the first cron execution, run migrations:

### Option 1: Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to the service
railway link

# Run migrations
railway run npm run migrate:up
```

### Option 2: Manual Migration via Railway Dashboard

1. Go to Service → Shell
2. Run:
   ```bash
   npm run migrate:up
   ```

**Expected Output**:
```
> @railrepay/data-retention-service@1.0.0 migrate:up
> node-pg-migrate up

Migration 1736100000000_initial-schema UP
All migrations completed successfully
```

### Verify Migration

```bash
railway run psql $DATABASE_URL -c "\dt data_retention.*"
```

**Expected Tables**:
- `data_retention.retention_policies`
- `data_retention.cleanup_history`
- `data_retention.outbox`

---

## One-Time Initial Cleanup

After deployment and migration, run the initial cleanup to clear historical data > 31 days:

```bash
railway run npm run cleanup:initial
```

**This script**:
1. Loads all retention policies
2. Executes cleanup for ALL data > 31 days old
3. Records cleanup history
4. Creates outbox events

**Expected Output**:
```
Starting initial cleanup for all policies...
Found 5 retention policies
Executing cleanup for darwin_ingestor.journey_updates_partitioned
Dropped 12 old partitions
Cleanup complete: 12 partitions dropped, 0 records deleted
```

---

## Verify Deployment

### 1. Check Cron Job Status

1. Go to Railway dashboard → Service
2. Verify "Next Run" shows correct time (03:00 UTC)
3. Check "Last Run" after first execution

### 2. Test Health Endpoint

```bash
curl https://<railway-service-url>/health
```

**Expected Response**:
```json
{
  "status": "ok",
  "service": "data-retention-service",
  "timestamp": "2026-01-05T13:00:00.000Z",
  "database": "connected",
  "uptime": 120
}
```

### 3. Test Metrics Endpoint

```bash
curl https://<railway-service-url>/metrics
```

**Expected Response**: Prometheus metrics format

### 4. Verify Grafana Metrics

1. Navigate to Grafana Cloud
2. Open "data-retention-service" dashboard
3. Verify metrics are flowing:
   - `data_retention_cleanup_total`
   - `data_retention_records_deleted_total`
   - `data_retention_partitions_dropped_total`

### 5. Check Logs in Loki

1. Navigate to Grafana Cloud → Loki
2. Filter by `service="data-retention-service"`
3. Verify structured JSON logs are appearing

---

## Rollback Procedure

Per ADR-005, Railway native rollback is our safety mechanism.

### When to Rollback

- Cron job execution fails consistently
- Database errors during cleanup
- Metrics/logs not flowing to Grafana
- Health check fails

### How to Rollback

**Via Railway Dashboard**:
1. Go to Service → Deployments
2. Find the previous successful deployment
3. Click "..." → "Rollback to this deployment"
4. Confirm rollback

**Via Railway CLI**:
```bash
railway rollback
```

**Database Rollback** (if migration was applied):
```bash
railway run npm run migrate:down
```

---

## Monitoring & Alerts

### Grafana Cloud Alerts

Configure the following alerts in Grafana Cloud:

1. **Cron Job Failed**
   - Condition: No successful cleanup in 48 hours
   - Severity: High
   - Action: Page on-call DevOps

2. **Database Errors**
   - Condition: `data_retention_errors_total > 5` in 1 hour
   - Severity: High
   - Action: Alert DevOps Slack

3. **No Metrics Flowing**
   - Condition: No metrics received in 2 hours
   - Severity: Medium
   - Action: Alert DevOps Slack

### Runbook References

See `RUNBOOK.md` for operational procedures:
- Troubleshooting failed cleanups
- Manual cleanup execution
- Database backup/restore
- Log analysis

---

## Next Steps

After Railway setup is complete:

1. Verify first cron execution succeeds
2. Monitor Grafana dashboards for 48 hours
3. Review cleanup history in database
4. Hand off to Quinn for Phase 6 verification

---

**Setup Date**: 2026-01-05
**Owner**: Moykle (DevOps Engineer)
**Phase**: Phase 5 - Deployment
