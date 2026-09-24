/**
 * 端到端加密同步引擎
 *
 * 上行：SyncQueue 里的本地变更 → 用 FDK 加密 → 推到远端
 * 下行：按 updated_at 增量拉密文 → 本地解密 → 冲突裁决 → 写入本地仓储
 *
 * 服务端全程只见密文；冲突裁决与聚合都在客户端（见 ADR-0006）。
 */

import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';
import { buildAad, decodeRecord, encodeRecord } from './codec';
import { computeNextCursor, resolveConflict } from './conflict';
import type {
  AssetPort,
  PullStats,
  PushStats,
  QueuePort,
  RemoteAdapter,
  RemoteRow,
  SnapshotPort,
  SyncKind,
  SyncQueueEntry,
} from './types';

export interface SyncEngineDeps {
  remote: RemoteAdapter;
  assets: AssetPort;
  snapshots: SnapshotPort;
  queue: QueuePort;
  /** 数据加密密钥 FDK（32 字节） */
  fdk: Uint8Array;
  familyId: string;
  /** 起始游标，默认 null（首次全量） */
  cursor?: string | null;
  /** 时间源，注入便于测试 */
  now?: () => string;
}

const DEFAULT_KINDS: readonly SyncKind[] = ['asset', 'snapshot'];

function defaultNow(): string {
  return new Date().toISOString();
}

/** 从 payload 里安全取 updatedAt（快照没有该字段） */
function extractUpdatedAt(payload: unknown): string | null {
  if (typeof payload === 'object' && payload !== null) {
    const v = (payload as Record<string, unknown>)['updatedAt'];
    if (typeof v === 'string') return v;
  }
  return null;
}

export class SyncEngine {
  private cursor: string | null;

  constructor(private readonly deps: SyncEngineDeps) {
    this.cursor = deps.cursor ?? null;
  }

  /** 当前增量游标（可用于持久化，下次启动接着拉） */
  getCursor(): string | null {
    return this.cursor;
  }

  /** 下拉：远端 → 本地 */
  async pull(kinds: readonly SyncKind[] = DEFAULT_KINDS): Promise<PullStats> {
    const stats: PullStats = { pulled: 0, applied: 0, conflicts: 0, failed: 0 };
    const aad = buildAad(this.deps.familyId);
    const rows = await this.deps.remote.pull(this.cursor, kinds);
    stats.pulled = rows.length;

    for (const row of rows) {
      if (row.kind === 'asset') {
        const payload = decodeRecord<Asset>(row.envelope, this.deps.fdk, aad);
        if (payload === null) {
          stats.failed++;
          continue;
        }
        const local = await this.deps.assets.findById(row.id);
        const winner = resolveConflict(
          local === null ? null : { updatedAt: local.updatedAt, deletedAt: local.deletedAt },
          { updatedAt: row.updatedAt, deletedAt: row.deletedAt },
        );
        if (winner === 'local') {
          stats.conflicts++;
          continue;
        }
        await this.deps.assets.upsert({
          ...payload,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        });
        stats.applied++;
      } else {
        // 删除墓碑：远端行 deleted_at 非空表示该快照已被删除，本地同步移除
        if (row.deletedAt !== null) {
          if (await this.deps.snapshots.has(row.id)) {
            await this.deps.snapshots.remove(row.id);
            stats.applied++;
          }
          continue;
        }
        const payload = decodeRecord<AssetSnapshot>(row.envelope, this.deps.fdk, aad);
        if (payload === null) {
          stats.failed++;
          continue;
        }
        // 快照 append-only：靠 id 幂等，重复拉取不重复写入
        if (await this.deps.snapshots.has(row.id)) continue;
        await this.deps.snapshots.append(payload);
        stats.applied++;
      }
    }

    this.cursor = computeNextCursor(rows, this.cursor);
    return stats;
  }

  /** 上行：本地 → 远端 */
  async push(): Promise<PushStats> {
    const stats: PushStats = { pushed: 0, failed: 0 };
    const aad = buildAad(this.deps.familyId);
    const pending = await this.deps.queue.pending();
    if (pending.length === 0) return stats;

    const now = this.deps.now ?? defaultNow;
    const rows: RemoteRow[] = [];
    const entryByRecordId = new Map<string, SyncQueueEntry>();

    for (const entry of pending) {
      const stamp = now();
      const isDelete = entry.op === 'delete';
      const updatedAt = isDelete ? stamp : (extractUpdatedAt(entry.payload) ?? entry.createdAt);
      rows.push({
        id: entry.recordId,
        kind: entry.table === 'asset_snapshots' ? 'snapshot' : 'asset',
        updatedAt,
        deletedAt: isDelete ? stamp : null,
        // 删除时不必上传明文内容
        envelope: encodeRecord(isDelete ? {} : entry.payload, this.deps.fdk, aad),
      });
      entryByRecordId.set(entry.recordId, entry);
    }

    const acks = await this.deps.remote.push(rows);
    for (const ack of acks) {
      const entry = entryByRecordId.get(ack.id);
      if (entry === undefined) continue;
      if (ack.ok) {
        await this.deps.queue.markDone(entry.id);
        stats.pushed++;
      } else {
        await this.deps.queue.markFailed(entry.id);
        stats.failed++;
      }
    }
    return stats;
  }
}
