/**
 * Health Routes Unit Tests
 *
 * TDD Approach: Test health check endpoint responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the database client before importing routes
vi.mock('../../../src/database/client', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { healthRoutes } from '../../../src/api/health-routes';
import { db } from '../../../src/database/client';

describe('Health Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(healthRoutes);
    vi.clearAllMocks();
  });

  it('should return healthy status when database is accessible', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ '?column?': 1 }] } as any);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.checks.database).toBe('ok');
  });

  it('should return unhealthy status when database is not accessible', async () => {
    vi.mocked(db.query).mockRejectedValue(new Error('Connection failed'));

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.checks.database).toBe('failed');
  });

  it('should return ready status', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
  });
});
