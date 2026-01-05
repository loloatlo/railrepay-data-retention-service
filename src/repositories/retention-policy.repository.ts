/**
 * RetentionPolicyRepository
 *
 * Repository pattern for data_retention.retention_policies table.
 * Provides data access methods for retention policy configuration.
 */

import type { RetentionPolicy } from '../strategies/cleanup-strategy.interface';

export class RetentionPolicyRepository {
  constructor(private db: any) {}

  async findEnabled(): Promise<RetentionPolicy[]> {
    const query = `
      SELECT *
      FROM data_retention.retention_policies
      WHERE enabled = true
      ORDER BY target_schema
    `;
    return await this.db.any(query);
  }

  async updateLastCleanup(policyId: string, timestamp: Date): Promise<void> {
    const query = `
      UPDATE data_retention.retention_policies
      SET last_cleanup_at = $2, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.none(query, [policyId, timestamp]);
  }
}
