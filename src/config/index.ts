/**
 * Configuration Loader
 *
 * Loads environment variables and provides typed configuration for the service.
 * Uses dotenv for local development.
 *
 * Per ADR-002: All config must be externalized via environment variables.
 */

import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Server
  port: number;
  nodeEnv: string;

  // Database
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    schema: string;
    maxConnections: number;
    ssl: boolean;
  };

  // GCS
  gcs: {
    projectId: string;
    keyFilename?: string;
  };

  // Service
  service: {
    name: string;
    version: string;
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'railrepay',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    schema: process.env.DATABASE_SCHEMA || 'data_retention',
    maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
    ssl: process.env.PGSSLMODE === 'require',
  },

  gcs: {
    projectId: process.env.GCS_PROJECT_ID || 'railrepay-mvp',
    keyFilename: process.env.GCS_KEY_FILENAME,
  },

  service: {
    name: process.env.SERVICE_NAME || 'data-retention-service',
    version: process.env.npm_package_version || '1.0.0',
  },
};
