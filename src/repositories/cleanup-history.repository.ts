/**
 * CleanupHistoryRepository
 *
 * Repository pattern for data_retention.cleanup_history table.
 * Provides audit trail for all cleanup operations.
 */

export interface CleanupHistoryCreate {
  policy_id: string;
  target_schema: string;
  started_at: Date;
  status: 'running' | 'success' | 'failed';
  error_message?: string;
}

export interface CleanupHistoryComplete {
  recordsDeleted: number;
  partitionsDropped: string[];
  gcsFilesDeleted: number;
  status: 'success' | 'failed';
  completed_at: Date;
  error_message?: string;
}

interface CleanupHistoryRow {
  id: string;
}

import { db } from '../database/client';

export class CleanupHistoryRepository {
  async create(data: CleanupHistoryCreate): Promise<string> {
    const query = `
      INSERT INTO data_retention.cleanup_history
        (policy_id, target_schema, started_at, status, error_message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const result = await db.queryOne<CleanupHistoryRow>(query, [
      data.policy_id,
      data.target_schema,
      data.started_at,
      data.status,
      data.error_message || null,
    ]);
    if (!result) {
      throw new Error('Failed to create cleanup history record');
    }
    return result.id;
  }

  async complete(historyId: string, data: CleanupHistoryComplete): Promise<void> {
    const query = `
      UPDATE data_retention.cleanup_history
      SET
        records_deleted = $2,
        partitions_dropped = $3,
        gcs_files_deleted = $4,
        status = $5,
        completed_at = $6,
        error_message = $7
      WHERE id = $1
    `;
    await db.query(query, [
      historyId,
      data.recordsDeleted,
      data.partitionsDropped,
      data.gcsFilesDeleted,
      data.status,
      data.completed_at,
      data.error_message || null,
    ]);
  }
}
