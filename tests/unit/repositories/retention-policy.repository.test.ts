/**
 * RetentionPolicyRepository Unit Tests
 *
 * TDD Approach: Write failing tests first, then implement.
 *
 * Repository pattern for data_retention.retention_policies table access.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetentionPolicyRepository } from '../../../src/repositories/retention-policy.repository';
import type { RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';

describe('RetentionPolicyRepository', () => {
  let repository: RetentionPolicyRepository;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      any: vi.fn(),
      none: vi.fn(),
    };
    repository = new RetentionPolicyRepository(mockDb);
  });

  it('should find all enabled policies', async () => {
    const mockPolicies = [
      {
        id: '123',
        target_schema: 'darwin_ingestor',
        retention_days: 31,
        cleanup_strategy: 'partition_drop',
        enabled: true,
        last_cleanup_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    mockDb.any.mockResolvedValue(mockPolicies);

    const policies = await repository.findEnabled();

    expect(mockDb.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE enabled = true')
    );
    expect(policies).toHaveLength(1);
    expect(policies[0].target_schema).toBe('darwin_ingestor');
  });

  it('should update last_cleanup_at timestamp', async () => {
    const policyId = 'test-policy-id';
    const timestamp = new Date();

    await repository.updateLastCleanup(policyId, timestamp);

    expect(mockDb.none).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.arrayContaining([policyId])
    );
  });
});
