# Environment Variables - Data Retention Service

**Service**: `data-retention-service`
**Environment**: Production (Railway)
**Owner**: DevOps (Moykle)

---

## Required Environment Variables

All variables listed below are **REQUIRED** for production deployment.

### Service Identity

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SERVICE_NAME` | Service identifier | `data-retention-service` | Yes |
| `DATABASE_SCHEMA` | PostgreSQL schema name (ADR-001) | `data_retention` | Yes |
| `PORT` | HTTP server port | `3000` | Yes |
| `NODE_ENV` | Node.js environment | `production` | Yes |

**Railway Configuration**:
```bash
SERVICE_NAME=data-retention-service
DATABASE_SCHEMA=data_retention
PORT=3000
NODE_ENV=production
```

---

### PostgreSQL Database

The service uses the **shared RailRepay PostgreSQL instance** with schema-per-service isolation (ADR-001).

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://user:pass@host:5432/db` | Yes |
| `PGHOST` | PostgreSQL hostname | `postgres.railway.internal` | Yes |
| `PGPORT` | PostgreSQL port | `5432` | Yes |
| `PGDATABASE` | PostgreSQL database name | `railway` | Yes |
| `PGUSER` | PostgreSQL username | `postgres` | Yes |
| `PGPASSWORD` | PostgreSQL password | `<Railway generated>` | Yes |
| `PGSSLMODE` | SSL mode | `require` | Yes |

**Railway Configuration**:
```bash
# Get from Railway PostgreSQL service
DATABASE_URL=${{Postgres.DATABASE_URL}}
PGHOST=${{Postgres.PGHOST}}
PGPORT=${{Postgres.PGPORT}}
PGDATABASE=${{Postgres.PGDATABASE}}
PGUSER=${{Postgres.PGUSER}}
PGPASSWORD=${{Postgres.PGPASSWORD}}
PGSSLMODE=require
```

**How to get Railway PostgreSQL credentials**:
1. Navigate to Railway Dashboard
2. Select the shared PostgreSQL service
3. Copy the connection variables from the "Variables" tab
4. Paste into `data-retention-service` environment variables

---

### Google Cloud Storage (GCS)

Required for cleaning up archived GTFS files in GCS buckets.

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `GCS_CREDENTIALS_BASE64` | Base64-encoded GCS service account JSON | `eyJhbGciOiJSUzI1NiIsInR5c...` | Yes |
| `GCS_GTFS_ARCHIVE_BUCKET` | GCS bucket name for GTFS archives | `railrepay-gtfs-archive` | Yes |

**How to encode GCS credentials**:
```bash
# Encode service account JSON to Base64
cat gcs-service-account.json | base64 -w 0 > gcs-credentials-base64.txt

# Copy the base64 string to Railway environment variable
```

**Railway Configuration**:
```bash
GCS_CREDENTIALS_BASE64=<paste base64 string>
GCS_GTFS_ARCHIVE_BUCKET=railrepay-gtfs-archive
```

**Service Account Permissions**:
The GCS service account must have:
- `storage.objects.delete` - Delete archived files
- `storage.objects.list` - List bucket contents

---

### Observability (Grafana Cloud)

The service sends metrics and logs to Grafana Cloud via the Grafana Alloy agent.

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `ALLOY_PUSH_URL` | Grafana Alloy push endpoint | `https://alloy.grafana.net/push` | Yes |
| `LOKI_BASIC_AUTH` | Loki basic auth credentials | `user:password` | Yes |
| `LOG_LEVEL` | Winston log level | `info` | Yes |

**Railway Configuration**:
```bash
ALLOY_PUSH_URL=<from Grafana Cloud>
LOKI_BASIC_AUTH=<from Grafana Cloud>
LOG_LEVEL=info
```

**How to get Grafana Cloud credentials**:
1. Navigate to Grafana Cloud → Connections
2. Find "Prometheus" and "Loki" data sources
3. Copy the push URLs and credentials
4. Configure Alloy agent with these credentials

**Note**: The Grafana Alloy agent runs as a separate Railway service that scrapes metrics from all RailRepay services.

---

### Retention Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `DEFAULT_RETENTION_DAYS` | Default retention period | `31` | Yes |

**Railway Configuration**:
```bash
DEFAULT_RETENTION_DAYS=31
```

**Note**: Individual retention policies in the database can override this default.

---

## Optional Environment Variables

These variables have sensible defaults but can be overridden.

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `MAX_CONNECTIONS` | PostgreSQL pool size | `10` | `20` |
| `IDLE_TIMEOUT_MS` | Connection idle timeout | `30000` | `60000` |
| `CONNECTION_TIMEOUT_MS` | Connection timeout | `5000` | `10000` |

---

## Development vs Production

### Development (.env file)

```bash
# Service Identity
SERVICE_NAME=data-retention-service
DATABASE_SCHEMA=data_retention
PORT=3000
NODE_ENV=development

# PostgreSQL (local)
DATABASE_URL=postgresql://postgres:password@localhost:5432/railrepay_dev
PGHOST=localhost
PGPORT=5432
PGDATABASE=railrepay_dev
PGUSER=postgres
PGPASSWORD=password
PGSSLMODE=prefer

# GCS (dev credentials)
GCS_CREDENTIALS_BASE64=<dev service account>
GCS_GTFS_ARCHIVE_BUCKET=railrepay-gtfs-archive-dev

# Observability (local)
ALLOY_PUSH_URL=http://localhost:9090/push
LOKI_BASIC_AUTH=
LOG_LEVEL=debug

# Retention
DEFAULT_RETENTION_DAYS=7
```

### Production (Railway)

Use the Railway-provided variables and production Grafana Cloud credentials.

---

## Security Best Practices

### Secrets Management

- **NEVER** commit `.env` files to Git
- Use Railway's built-in secrets management
- Rotate credentials every 90 days
- Use least-privilege service accounts

### Access Control

- `PGPASSWORD`: Rotate monthly
- `GCS_CREDENTIALS_BASE64`: Use dedicated service account with minimal permissions
- `LOKI_BASIC_AUTH`: Use read/write token, not admin

### Validation

Before deployment, verify all required variables are set:

```bash
# Via Railway CLI
railway variables list

# Check for missing variables
railway variables list | grep -E "(SERVICE_NAME|DATABASE_URL|GCS_CREDENTIALS_BASE64|ALLOY_PUSH_URL)"
```

---

## Troubleshooting

### Variable Not Found

**Error**: `Error: Environment variable X is not defined`

**Fix**:
1. Verify variable is set in Railway
2. Redeploy service to pick up new variables

### Invalid Database Connection

**Error**: `Error: connection to server failed`

**Fix**:
1. Verify `DATABASE_URL` format is correct
2. Check PostgreSQL service is running
3. Verify `PGSSLMODE=require` for Railway

### GCS Authentication Failed

**Error**: `Error: Could not load the default credentials`

**Fix**:
1. Verify `GCS_CREDENTIALS_BASE64` is valid Base64
2. Test decoding: `echo $GCS_CREDENTIALS_BASE64 | base64 -d | jq`
3. Verify service account has correct permissions

### Metrics Not Appearing in Grafana

**Error**: No metrics flowing to Grafana Cloud

**Fix**:
1. Verify `ALLOY_PUSH_URL` is correct
2. Test connectivity: `curl -v $ALLOY_PUSH_URL`
3. Check Grafana Alloy agent is running on Railway

---

## Reference

For `.env.example` template, see:
- `/data-retention-service/.env.example`

For Railway setup instructions, see:
- `/docs/deployment/RAILWAY-SETUP.md`

---

**Last Updated**: 2026-01-05
**Owner**: Moykle (DevOps Engineer)
**Phase**: Phase 5 - Deployment
