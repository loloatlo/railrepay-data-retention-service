/**
 * Health Check Routes
 *
 * Per ADR-008: All services must expose health check endpoints for monitoring.
 * Railway uses these for deployment health verification.
 */

import { Router, Request, Response } from 'express';
import { db } from '../database/client';

const router = Router();

router.get('/health', async (req: Request, res: Response) => {
  try {
    // Check database connectivity
    await db.query('SELECT 1');

    res.json({
      status: 'healthy',
      service: 'data-retention-service',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
      },
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'data-retention-service',
      timestamp: new Date().toISOString(),
      error: error.message,
      checks: {
        database: 'failed',
      },
    });
  }
});

router.get('/health/ready', async (req: Request, res: Response) => {
  // Simple readiness check
  res.json({
    ready: true,
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRoutes };
