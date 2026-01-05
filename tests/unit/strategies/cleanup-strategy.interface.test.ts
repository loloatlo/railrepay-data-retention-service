/**
 * Cleanup Strategy Interface Tests
 *
 * TDD Approach: Verify type definitions and interface contracts before implementation.
 * Tests ensure that CleanupStrategy implementations will conform to expected contracts.
 */

import { describe, it, expect } from 'vitest';
import type { CleanupStrategy, CleanupResult, RetentionPolicy } from '../../../src/strategies/cleanup-strategy.interface';

describe('CleanupStrategy Interface', () => {
  it('should define RetentionPolicy with required fields', () => {
    const policy: RetentionPolicy = {
      id: 'test-uuid',
      target_schema: 'darwin_ingestor',
      retention_days: 31,
      cleanup_strategy: 'partition_drop',
      enabled: true,
      last_cleanup_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(policy.id).toBe('test-uuid');
    expect(policy.target_schema).toBe('darwin_ingestor');
    expect(policy.retention_days).toBe(31);
    expect(policy.cleanup_strategy).toBe('partition_drop');
    expect(policy.enabled).toBe(true);
  });

  it('should define CleanupResult with required fields', () => {
    const result: CleanupResult = {
      recordsDeleted: 100,
      partitionsDropped: ['delay_services_2024_01'],
      gcsFilesDeleted: 5,
      dryRun: false,
    };

    expect(result.recordsDeleted).toBe(100);
    expect(result.partitionsDropped).toHaveLength(1);
    expect(result.gcsFilesDeleted).toBe(5);
    expect(result.dryRun).toBe(false);
  });

  it('should require CleanupStrategy to have name and execute method', () => {
    // This test verifies the interface contract at compile time
    // TypeScript will enforce that any implementation has these members
    const mockStrategy: CleanupStrategy = {
      name: 'test-strategy',
      execute: async () => ({
        recordsDeleted: 0,
        partitionsDropped: [],
        gcsFilesDeleted: 0,
        dryRun: true,
      }),
    };

    expect(mockStrategy.name).toBe('test-strategy');
    expect(typeof mockStrategy.execute).toBe('function');
  });

  it('should allow cleanup_strategy to be one of three valid types', () => {
    const validStrategies: Array<'partition_drop' | 'date_delete' | 'gcs_cleanup'> = [
      'partition_drop',
      'date_delete',
      'gcs_cleanup',
    ];

    validStrategies.forEach((strategy) => {
      const policy: RetentionPolicy = {
        id: 'test',
        target_schema: 'test',
        retention_days: 31,
        cleanup_strategy: strategy,
        enabled: true,
        last_cleanup_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      expect(policy.cleanup_strategy).toBe(strategy);
    });
  });
});
