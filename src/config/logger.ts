/**
 * Winston Logger Configuration
 *
 * Uses @railrepay/winston-logger for structured logging with correlation IDs.
 * Per ADR-002: All services must use standardized logging.
 *
 * Outputs JSON for Grafana Loki ingestion via Alloy agent.
 */

import { createLogger } from '@railrepay/winston-logger';
import { config } from './index';

export const logger = createLogger({
  serviceName: config.service.name,
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
});
