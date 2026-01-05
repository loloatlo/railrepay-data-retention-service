/**
 * Metrics Routes
 *
 * Per ADR-006: All services must expose Prometheus metrics for observability.
 * Metrics are collected by Grafana Alloy agent on Railway.
 */

import { Router, Request, Response } from 'express';
import { register } from 'prom-client';

const router = Router();

router.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

export { router as metricsRoutes };
