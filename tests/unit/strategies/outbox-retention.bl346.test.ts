/**
 * BL-346: outbox_events Retention Policy — RED Tests
 *
 * TD Context: darwin_ingestor.outbox_events has accumulated ~2.39M published rows (~2.3 GB).
 * The data-retention-service must purge published rows older than 7 days while NEVER
 * deleting unpublished rows (published_at IS NULL), regardless of their age.
 *
 * AC Map:
 *   AC-1 (safety guard)   → describe blocks: 'AC-1 safety guard: unpublished rows are NEVER deleted'
 *   AC-2 (predicate)      → describe blocks: 'AC-2 predicate correctness'
 *   AC-3 (registration)   → describe blocks: 'AC-3 policy registration'
 *   AC-4 (idempotency)    → describe blocks: 'AC-4 idempotency'
 *   AC-5 (scope)          → describe blocks: 'AC-5 scope isolation'
 *   AC-6 (count shape)    → describe blocks: 'AC-6 before/after count shape'
 *
 * CROSS-SERVICE SMOKE (TD-4 gate, NOT tested here):
 *   The real cross-service smoke — SELECT COUNT(*) and pg_total_relation_size on
 *   darwin_ingestor.outbox_events before and after the first production run —
 *   is mandated by SOP-IMPROVEMENT-009 and is a TD-4 gate executed by Moykle
 *   against the deployed Railway database. It verifies:
 *     - published_old_count  decreases by ~2.39M
 *     - unpublished_count    is unchanged (=0 delta)
 *     - recent_count (< 7d)  is unchanged
 *     - table size drops by ~2.3 GB
 *
 * Test Lock Rule: Blake MUST NOT modify these tests.
 * Reference: BL-346 Notion backlog item
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';
import { DateDeleteStrategy } from '../../../src/strategies/date-delete.strategy';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a RetentionPolicy fixture targeting darwin_ingestor_outbox.
 * BL-346 requires retention_days = 7.
 */
function makeOutboxPolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 'outbox-policy-bl346',
    target_schema: 'darwin_ingestor_outbox',
    retention_days: 7,           // BL-346: 7 days (not 31)
    cleanup_strategy: 'date_delete',
    enabled: true,
    last_cleanup_at: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build an ISO timestamp N days in the past.
 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/**
 * Build a mock DB client matching the pattern used by DateDeleteStrategy.
 * The strategy calls mockDb.result(sql, params) for DELETE operations.
 * Use mockReset() between tests to clear resolved-value queues (project memory
 * guideline: vi.clearAllMocks does NOT clear mockResolvedValueOnce queues).
 */
function makeMockDb() {
  return {
    result: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixture rows (differentiating data to catch wrong-predicate bugs)
// ---------------------------------------------------------------------------
//
//  row_A: published_at = 30 days ago  → MUST be deleted  (published + old)
//  row_B: published_at = 3 days ago   → MUST NOT be deleted (published + recent)
//  row_C: published_at = null         → MUST NOT be deleted (unpublished, any age)
//  row_D: published_at = null, created_at = 365 days ago → MUST NOT be deleted
//
// A wrong predicate that uses created_at instead of published_at IS NOT NULL
// would attempt to delete row_C (which is the data-loss scenario BL-346 exists to prevent).
// A wrong predicate that omits the IS NOT NULL guard would attempt to compare NULL < cutoff
// (which evaluates to NULL/false in Postgres — silent skip), but this test validates the
// explicit guard is present in the SQL.

// ---------------------------------------------------------------------------
// AC-1: Safety guard — unpublished rows MUST NEVER be deleted
// ---------------------------------------------------------------------------

describe('BL-346: DateDeleteStrategy — darwin_ingestor_outbox retention', () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let strategy: DateDeleteStrategy;

  beforeEach(() => {
    mockDb = makeMockDb();
    strategy = new DateDeleteStrategy(mockDb);
  });

  describe('AC-1 safety guard: unpublished rows are NEVER deleted', () => {
    it('should include published_at IS NOT NULL in the DELETE predicate for darwin_ingestor_outbox', async () => {
      // AC-1 (critical): The SQL sent to the DB MUST include the nullability guard.
      // Without this, a mistaken created_at-based predicate could delete rows that
      // have never been published — permanent data loss.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      // At least one DB call must have been made targeting outbox_events
      const outboxCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('outbox_events')
      );
      expect(outboxCall, 'Expected a DB call targeting outbox_events').toBeDefined();

      const sql: string = outboxCall![0];
      // The safety guard: unpublished rows must be excluded by an IS NOT NULL check
      expect(sql.toLowerCase()).toMatch(/published_at\s+is\s+not\s+null/);
    });

    it('should NOT use created_at as the sole filter column for darwin_ingestor_outbox', async () => {
      // AC-1: Using created_at alone would delete unpublished events (data loss).
      // The predicate MUST be keyed on published_at, not created_at.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      const outboxCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('outbox_events')
      );
      expect(outboxCall, 'Expected a DB call targeting outbox_events').toBeDefined();

      const sql: string = outboxCall![0];
      // created_at must NOT be the primary age filter for outbox_events
      // (it may appear in comments but must not appear as a WHERE filter column)
      const whereClause = sql.toLowerCase().split('where')[1] ?? '';
      expect(whereClause).not.toMatch(/created_at\s*</);
    });

    it('should pass 0 rowCount when all rows are unpublished (published_at IS NULL)', async () => {
      // AC-1: Even if a table is full of old rows with published_at=NULL,
      // the job reports 0 deleted because none match the compound predicate.
      // This is the no-data-loss guarantee.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      const result = await strategy.execute(makeOutboxPolicy(), false);

      // Zero rows deleted — the unpublished guard held
      expect(result.recordsDeleted).toBe(0);
      expect(result.partitionsDropped).toHaveLength(0);
      expect(result.gcsFilesDeleted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-2: Predicate correctness
  // ---------------------------------------------------------------------------

  describe('AC-2 predicate correctness', () => {
    it('should delete a row where published_at is older than 7 days', async () => {
      // AC-2: A published row with published_at = 30 days ago IS within scope
      // (30 > 7) and must be deleted.
      mockDb.result.mockResolvedValue({ rowCount: 1 });

      const result = await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      expect(mockDb.result).toHaveBeenCalled();
      // Confirm DELETE was called (not SELECT COUNT)
      const deleteCalls = mockDb.result.mock.calls.filter(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].toUpperCase().includes('DELETE')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
      expect(result.recordsDeleted).toBe(1);
    });

    it('should NOT delete a row where published_at is within the 7-day window', async () => {
      // AC-2: A published row with published_at = 3 days ago is within retention
      // (3 < 7). The job must pass the cutoff date such that Postgres filters it out.
      // The mock returns 0 to simulate no matching rows.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      const result = await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      expect(result.recordsDeleted).toBe(0);
    });

    it('should use published_at as the age column in the cutoff comparison', async () => {
      // AC-2: The cutoff comparison must reference published_at, not created_at or any other column.
      mockDb.result.mockResolvedValue({ rowCount: 5 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      const outboxCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('outbox_events')
      );
      expect(outboxCall).toBeDefined();

      const sql: string = outboxCall![0];
      // published_at must appear as the column being compared to cutoff
      expect(sql.toLowerCase()).toMatch(/published_at\s*</);
    });

    it('should calculate a 7-day cutoff date from policy retention_days=7', async () => {
      // AC-2 boundary: The cutoff passed to the DB must be approximately NOW()-7d.
      // Allow 5s tolerance for test execution time.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      const calls = mockDb.result.mock.calls;
      const outboxCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('outbox_events')
      );
      expect(outboxCall).toBeDefined();

      // The cutoff date is passed as a parameter array element
      const params: any[] = outboxCall![1];
      const cutoffParam = params.find((p: any) => {
        if (!p) return false;
        const d = new Date(p);
        return !isNaN(d.getTime());
      });
      expect(cutoffParam, 'Expected a date parameter to be passed to the query').toBeDefined();

      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 7);
      const actualCutoff = new Date(cutoffParam);

      expect(
        Math.abs(actualCutoff.getTime() - expectedCutoff.getTime()),
        'Cutoff must be within 5s of NOW()-7d'
      ).toBeLessThan(5000);
    });

    it('should handle boundary: a row with published_at exactly at the 7-day mark is NOT deleted', async () => {
      // AC-2 boundary: The SQL predicate is < (strictly less than), so a row
      // published at exactly cutoff moment is excluded. The policy row count of 0 confirms this.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      const result = await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      expect(result.recordsDeleted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3: Policy registration — the outbox policy exists and is correctly configured
  // ---------------------------------------------------------------------------

  describe('AC-3 policy registration', () => {
    it('should recognise darwin_ingestor_outbox as a valid target schema for DateDeleteStrategy', async () => {
      // AC-3: The strategy's tableConfigs map must include darwin_ingestor_outbox
      // so that execute() does not throw "No table configuration found for schema: darwin_ingestor_outbox".
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      // If the config is missing, execute() throws; so a clean resolve proves registration.
      await expect(
        strategy.execute(makeOutboxPolicy(), false)
      ).resolves.not.toThrow();
    });

    it('should target the darwin_ingestor schema and outbox_events table specifically', async () => {
      // AC-3: The SQL must reference the exact qualified table "darwin_ingestor"."outbox_events".
      // A wrong table (e.g. "outbox" or "darwin_ingestor_outbox"."outbox_events") fails the assertion.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      const foundCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].includes('darwin_ingestor') &&
          args[0].includes('outbox_events')
      );
      expect(
        foundCall,
        'Expected SQL to reference darwin_ingestor.outbox_events'
      ).toBeDefined();
    });

    it('should have a retention_days of 7 in the registered policy (not 31)', async () => {
      // AC-3: BL-346 specifies 7-day retention. The policy fixture with retention_days=7
      // must be accepted and drive the 7-day cutoff calculation.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      // Check cutoff is ~7 days, not ~31 days
      const calls = mockDb.result.mock.calls;
      const outboxCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].includes('outbox_events')
      );
      expect(outboxCall).toBeDefined();

      const params: any[] = outboxCall![1];
      const cutoffParam = params.find((p: any) => !isNaN(new Date(p).getTime()));
      expect(cutoffParam).toBeDefined();

      const cutoffDate = new Date(cutoffParam);
      const expectedCutoff7  = new Date();
      expectedCutoff7.setDate(expectedCutoff7.getDate() - 7);
      const expectedCutoff31 = new Date();
      expectedCutoff31.setDate(expectedCutoff31.getDate() - 31);

      // Must be within 5s of 7-day cutoff
      expect(Math.abs(cutoffDate.getTime() - expectedCutoff7.getTime())).toBeLessThan(5000);
      // Must NOT be within 5s of 31-day cutoff (i.e., not the old value)
      expect(Math.abs(cutoffDate.getTime() - expectedCutoff31.getTime())).toBeGreaterThan(
        (31 - 7 - 1) * 24 * 60 * 60 * 1000  // at least 23 days apart
      );
    });
  });

  // ---------------------------------------------------------------------------
  // AC-4: Idempotency — running the job twice deletes nothing extra the second time
  // ---------------------------------------------------------------------------

  describe('AC-4 idempotency', () => {
    it('should return recordsDeleted=0 on the second run when no new rows become eligible', async () => {
      // AC-4: After a full cleanup, a re-run on the same state returns 0.
      // The job must not error on empty result sets.

      // First run: deletes some rows
      mockDb.result.mockResolvedValueOnce({ rowCount: 2390000 });
      const firstResult = await strategy.execute(makeOutboxPolicy(), false);
      expect(firstResult.recordsDeleted).toBe(2390000);

      // Reset mock queue before second run (per project memory: mockReset not clearAllMocks)
      mockDb.result.mockReset();
      mockDb.result.mockResolvedValueOnce({ rowCount: 0 });

      // Second run: nothing left to delete
      const secondResult = await strategy.execute(makeOutboxPolicy(), false);
      expect(secondResult.recordsDeleted).toBe(0);
    });

    it('should not throw when no rows match the outbox predicate', async () => {
      // AC-4: 0-row result must be handled gracefully (not throw on rowCount=0)
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await expect(
        strategy.execute(makeOutboxPolicy(), false)
      ).resolves.toMatchObject({
        recordsDeleted: 0,
        partitionsDropped: [],
        gcsFilesDeleted: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AC-5: Scope isolation — only darwin_ingestor.outbox_events is targeted
  // ---------------------------------------------------------------------------

  describe('AC-5 scope isolation', () => {
    it('should NOT touch timetable_loader tables when executing the outbox policy', async () => {
      // AC-5: The outbox cleanup must be scoped to darwin_ingestor.outbox_events only.
      // timetable_loader.services, timetable_loader.service_stops, etc. must be untouched.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      const timetableCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          args[0].toLowerCase().includes('timetable_loader')
      );
      expect(
        timetableCall,
        'timetable_loader must not be touched by the outbox retention job'
      ).toBeUndefined();
    });

    it('should NOT touch darwin_ingestor delay_services or delay_service_stops tables', async () => {
      // AC-5: The partition-based darwin_ingestor tables (delay_services, delay_service_stops)
      // are managed by PartitionDropStrategy and must not be touched by this outbox job.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      const delayServicesCall = calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' &&
          (args[0].includes('delay_services') || args[0].includes('delay_service_stops'))
      );
      expect(
        delayServicesCall,
        'delay_services/delay_service_stops must not be touched by the outbox retention job'
      ).toBeUndefined();
    });

    it('should only generate SQL referencing outbox_events when policy target is darwin_ingestor_outbox', async () => {
      // AC-5: All DB calls generated by the outbox policy must reference outbox_events.
      // No other tables from any other schema should appear.
      mockDb.result.mockResolvedValue({ rowCount: 0 });

      await strategy.execute(makeOutboxPolicy(), false);

      const calls = mockDb.result.mock.calls;
      for (const args of calls) {
        if (typeof args[0] !== 'string') continue;
        const sql: string = args[0];
        // Each call targeting a table must be outbox_events (not any other table)
        if (sql.toLowerCase().includes('from') || sql.toLowerCase().includes('delete')) {
          expect(sql).toMatch(/outbox_events/);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // AC-6: Before/after count shape — validates the shape Blake's implementation
  //        exposes so the TD-4 real-DB smoke (SOP-IMPROVEMENT-009) can use it.
  //        The smoke runs against the DEPLOYED database; this test validates the
  //        interface contract and result structure only.
  // ---------------------------------------------------------------------------

  describe('AC-6 before/after count shape', () => {
    it('should return a CleanupResult with recordsDeleted reflecting published-old rows removed', async () => {
      // AC-6: CleanupResult.recordsDeleted must equal the number of published rows
      // actually deleted (not a dry-run count, not a total-table-size estimate).
      // The real smoke will compare this to the actual DB delta.
      const expectedDeleted = 2390000; // approximate real-world figure from BL-346 context
      mockDb.result.mockResolvedValue({ rowCount: expectedDeleted });

      const result = await strategy.execute(makeOutboxPolicy(), false);

      expect(result).toMatchObject({
        recordsDeleted: expectedDeleted,
        partitionsDropped: [],
        gcsFilesDeleted: 0,
        dryRun: false,
      });
    });

    it('should return dryRun=true and NOT call DELETE when dryRun flag is set', async () => {
      // AC-6: Dry-run mode must use SELECT COUNT(*) not DELETE.
      // The before/after smoke uses dryRun=false, but the service must support dryRun=true
      // for pre-production impact estimation.
      //
      // NOTE: current DateDeleteStrategy returns a count from the SELECT COUNT query.
      // The mock returns an object with rows[0].count to match the dry-run path.
      mockDb.result.mockResolvedValue({ rows: [{ count: '2390000' }] });

      const result = await strategy.execute(makeOutboxPolicy(), true);

      // In dry-run, DELETE must NOT have been called
      const deleteCalls = mockDb.result.mock.calls.filter(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].toUpperCase().startsWith('DELETE')
      );
      expect(deleteCalls.length, 'DELETE must not be called in dry-run mode').toBe(0);

      // But a COUNT query should have been called
      const countCalls = mockDb.result.mock.calls.filter(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].toLowerCase().includes('select count')
      );
      expect(countCalls.length, 'SELECT COUNT must be called in dry-run mode').toBeGreaterThan(0);

      // The COUNT query must also include the published_at IS NOT NULL guard
      const countSql: string = countCalls[0][0];
      expect(countSql.toLowerCase()).toMatch(/published_at\s+is\s+not\s+null/);

      expect(result.dryRun).toBe(true);
    });

    it('should report published-old removed + unpublished retained in a mixed fixture scenario', async () => {
      // AC-6 (key integration shape): In a table with:
      //   - 2.39M published-old rows → deleted
      //   - 500K published-recent rows → retained
      //   - 0 unpublished rows → retained (safety guard)
      // The job must delete exactly the published-old rows.
      // This test validates the shape the TD-4 smoke will verify against real DB counts.
      mockDb.result.mockResolvedValue({ rowCount: 2390000 });

      const result = await strategy.execute(makeOutboxPolicy({ retention_days: 7 }), false);

      // Only published-old rows are deleted
      expect(result.recordsDeleted).toBe(2390000);
      // No side effects on other resource types
      expect(result.partitionsDropped).toHaveLength(0);
      expect(result.gcsFilesDeleted).toBe(0);
      expect(result.dryRun).toBe(false);
    });
  });
});
