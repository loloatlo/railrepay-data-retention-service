/**
 * CleanupHistoryRepository Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Repository pattern for data_retention.cleanup_history table access.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CleanupHistoryRepository } from '../../../src/repositories/cleanup-history.repository';

describe('CleanupHistoryRepository', () => {
  let repository: CleanupHistoryRepository;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      one: vi.fn(),
      none: vi.fn(),
    };
    repository = new CleanupHistoryRepository(mockDb);
  });

  it('should create cleanup history record', async () => {
    const mockHistoryId = 'history-123';
    mockDb.one.mockResolvedValue({ id: mockHistoryId });

    const historyId = await repository.create({
      policy_id: 'policy-123',
      target_schema: 'darwin_ingestor',
      started_at: new Date(),
      status: 'running',
    });

    expect(mockDb.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO'),
      expect.any(Array)
    );
    expect(historyId).toBe(mockHistoryId);
  });

  it('should update cleanup history with results', async () => {
    const historyId = 'history-123';

    await repository.complete(historyId, {
      recordsDeleted: 100,
      partitionsDropped: ['part_2024_01'],
      gcsFilesDeleted: 5,
      status: 'success',
      completed_at: new Date(),
    });

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.arrayContaining([historyId])
    );
  });
});
