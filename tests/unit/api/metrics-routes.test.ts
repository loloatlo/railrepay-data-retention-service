/**
 * Metrics Routes Unit Tests
 *
 * TDD Approach: Test metrics endpoint response.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { metricsRoutes } from '../../../src/api/metrics-routes';

describe('Metrics Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(metricsRoutes);
  });

  it('should return Prometheus metrics endpoint', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    // Response should be a string (even if empty when no metrics registered)
    expect(typeof response.text).toBe('string');
  });
});
