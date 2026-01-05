/**
 * DateDeleteStrategy Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Target schemas: timetable_loader, darwin_ingestor (outbox)
 * Target tables:
 *   - timetable_loader.services (service_date column)
 *   - darwin_ingestor.outbox_events (published_at column)
 * Strategy: DELETE WHERE date_column < cutoff_date
 *
 * Related: Notion › Technical Debt Register TD-DARWIN-003 (outbox cleanup)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';
import { DateDeleteStrategy } from '../../../src/strategies/date-delete.strategy';

describe('DateDeleteStrategy', () => {
  let strategy: DateDeleteStrategy;
  let mockDbClient: any;

  beforeEach(() => {
    mockDbClient = {
      result: vi.fn(),
    };
    strategy = new DateDeleteStrategy(mockDbClient);
  });

  it('should have name "DateDeleteStrategy"', () => {
    expect(strategy.name).toBe('DateDeleteStrategy');
  });

  it('should delete records older than cutoff date', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock DELETE result with rowCount
    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 150,
    });

    const result = await strategy.execute(policy, false);

    expect(mockDbClient.result).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM'),
      expect.any(Array)
    );
    expect(result.recordsDeleted).toBe(150);
  });

  it('should handle timetable_loader services table', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 200,
    });

    const result = await strategy.execute(policy, false);

    // Verify the call includes the correct schema, table, and date column in parameters
    const callArgs = mockDbClient.result.mock.calls[0];
    expect(callArgs[1]).toEqual(
      expect.arrayContaining(['timetable_loader', 'services', 'service_date'])
    );
  });

  it('should handle darwin_ingestor outbox_events table', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'darwin_ingestor_outbox',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 749000, // TD-DARWIN-003: 749K events deleted
    });

    const result = await strategy.execute(policy, false);

    // Verify the call includes the correct schema, table, and date column in parameters
    const callArgs = mockDbClient.result.mock.calls[0];
    expect(callArgs[1]).toEqual(
      expect.arrayContaining(['darwin_ingestor', 'outbox', 'published_at'])
    );
    expect(result.recordsDeleted).toBe(749000);
  });

  it('should return deleted record count', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 42,
    });

    const result = await strategy.execute(policy, false);

    expect(result.recordsDeleted).toBe(42);
    expect(result.partitionsDropped).toHaveLength(0);
    expect(result.gcsFilesDeleted).toBe(0);
  });

  it('should support dry run mode without executing DELETE', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // In dry run, use COUNT(*) instead of DELETE
    mockDbClient.result.mockResolvedValueOnce({
      rows: [{ count: '100' }],
    });

    const result = await strategy.execute(policy, true);

    expect(mockDbClient.result).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*)'),
      expect.any(Array)
    );
    expect(mockDbClient.result).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM'),
      expect.any(Array)
    );
    expect(result.dryRun).toBe(true);
    expect(result.recordsDeleted).toBe(100);
  });

  it('should calculate cutoff date correctly based on retention_days', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 90, // 90 days retention
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 10,
    });

    await strategy.execute(policy, false);

    // Verify cutoff date is passed correctly
    const callArgs = mockDbClient.result.mock.calls[0];
    const cutoffDate = callArgs[1][3]; // Fourth parameter should be cutoff date (ISO string)

    const expectedCutoff = new Date();
    expectedCutoff.setDate(expectedCutoff.getDate() - 90);

    // Allow 1 second tolerance for test execution time
    expect(Math.abs(new Date(cutoffDate).getTime() - expectedCutoff.getTime())).toBeLessThan(2000);
  });

  it('should handle empty result (no records to delete)', async () => {
    const policy: RetentionPolicy = {
      id: 'test-id',
      target_schema: 'timetable_loader',
      retention_days: 31,
      cleanup_strategy: 'date_delete',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockDbClient.result.mockResolvedValueOnce({
      rowCount: 0,
    });

    const result = await strategy.execute(policy, false);

    expect(result.recordsDeleted).toBe(0);
  });
});
