/**
 * PostgreSQL Database Client
 *
 * Uses @railrepay/postgres-client for standardized database connections.
 * Per ADR-001: Schema-per-service isolation (data_retention schema).
 *
 * Note: PostgresClient.query() returns rows directly, not QueryResult.
 * For raw QueryResult access, use getPool().query().
 */

import { PostgresClient } from '@railrepay/postgres-client';
import { PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../config/logger';

/**
 * PostgreSQL client instance using shared @railrepay/postgres-client package
 */
const client = new PostgresClient({
  serviceName: config.service.name,
  schemaName: config.database.schema,
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl,
  poolSize: config.database.maxConnections,
  logger,
});

/**
 * Database client interface for the data-retention-service
 */
export const db = {
  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    await client.connect();
  },

  /**
   * Execute a query with parameters
   * Returns array of rows (not QueryResult)
   */
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return client.query<T>(sql, params);
  },

  /**
   * Execute a query and return a single row
   */
  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    return client.queryOne<T>(sql, params);
  },

  /**
   * Get a client from the pool for transactions
   */
  async getClient(): Promise<PoolClient> {
    return client.getClient();
  },

  /**
   * Test database connection (health check)
   */
  async testConnection(): Promise<boolean> {
    return client.healthCheck();
  },

  /**
   * Get the underlying pool for raw query access
   * Use when you need QueryResult instead of just rows
   */
  getPool() {
    return client.getPool();
  },

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await client.disconnect();
  },

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return client.isConnected();
  },
};
