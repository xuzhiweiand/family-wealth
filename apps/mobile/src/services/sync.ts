/**
 * 云端同步服务
 *
 * 上行：asset-store 每次变更调用 enqueue 入队 → SyncEngine.push 用 FDK
 *      加密后 upsert 到 sync_records（服务端只见密文）
 * 下行：syncNow 触发 SyncEngine.pull 增量拉取 → 解密写本地仓储 →
 *      再 assetStore.load 把仓储内容合并进 Zustand
 *
 * 无云端配置（supabase 为 null）或 FDK 尚未解出时全部 no-op：
 * InMemory 本地模式行为完全不变。
 *
 * 0.1.2 限制：队列与本地仓储均为进程内存态（未持久化）。离线期间
 * 杀掉 App 会丢失尚未上行的变更；下次联网重开后由下行同步重建数据。
 * 本地持久化（WatermelonDB）在后续版本接入。
 */

import {
  SyncEngine,
  SupabaseRemoteAdapter,
  type PushStats,
  type QueuePort,
  type SyncQueueEntry,
} from '@family-wealth/sync';
import { supabase } from './supabase';
import { assetRepository, snapshotRepository } from './bootstrap';
import { useAssetStore } from '../stores/asset-store';
import { useKeyStore } from '../stores/key-store';

// ---------- 内存上行队列（QueuePort） ----------

class InMemorySyncQueue implements QueuePort {
  private entries = new Map<string, SyncQueueEntry>();

  enqueue(input: {
    /** 业务表名：'asset' / 'asset_snapshots'（引擎再映射为远端 kind） */
    table: string;
    recordId: string;
    op: 'upsert' | 'delete';
    payload: unknown;
  }): void {
    // 同一记录的连续变更合并为最新一条（保留最早创建时间与 op 语义）
    const existing = [...this.entries.values()].find((e) => e.recordId === input.recordId);
    if (existing) {
      this.entries.set(existing.id, {
        ...existing,
        op: input.op === 'delete' ? 'delete' : existing.op,
        payload: input.op === 'delete' ? existing.payload : input.payload,
      });
      return;
    }
    const id = `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    this.entries.set(id, {
      id,
      table: input.table,
      recordId: input.recordId,
      op: input.op,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      retries: 0,
    });
  }

  async pending(): Promise<SyncQueueEntry[]> {
    return [...this.entries.values()];
  }

  async markDone(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async markFailed(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (e) this.entries.set(id, { ...e, retries: e.retries + 1 });
  }
}

export const syncQueue = new InMemorySyncQueue();

/** 业务层入队入口 */
export function enqueueChange(
  table: 'asset' | 'asset_snapshots',
  recordId: string,
  op: 'upsert' | 'delete',
  payload: unknown,
): void {
  if (!supabase) return;
  syncQueue.enqueue({ table, recordId, op, payload });
}

// ---------- 同步编排 ----------

let inFlight = false;

export interface SyncResult {
  pulled: number;
  applied: number;
  pushed: number;
  failed: number;
}

/**
 * 执行一次「推 → 拉 → 合并」。并发调用合并为同一轮（进程级互斥）。
 * 无 supabase / 无 FDK 时静默跳过。
 */
export async function syncNow(familyId: string): Promise<SyncResult | null> {
  if (!supabase) return null;
  const fdk = useKeyStore.getState().fdk;
  if (!fdk) return null;
  if (inFlight) return null;
  inFlight = true;

  const empty: SyncResult = { pulled: 0, applied: 0, pushed: 0, failed: 0 };
  try {
    const engine = new SyncEngine({
      remote: new SupabaseRemoteAdapter(supabase, familyId),
      assets: {
        findById: (id) => assetRepository.findById(id),
        upsert: (a) => assetRepository.upsert(a),
      },
      snapshots: {
        has: async (id) =>
          (await snapshotRepository.list({ familyId })).some((s) => s.id === id),
        append: (s) => snapshotRepository.append(s),
        remove: (id) => snapshotRepository.remove(id),
      },
      queue: syncQueue,
      fdk,
      familyId,
    });

    const pushStats: PushStats = await engine.push();
    const pullStats = await engine.pull();

    // 下行写入了仓储 → 重新合并进 Zustand（含其他成员的变更）
    if (pullStats.applied > 0) {
      await useAssetStore.getState().load(familyId);
    }

    return {
      pulled: pullStats.pulled,
      applied: pullStats.applied,
      pushed: pushStats.pushed,
      failed: pullStats.failed + pushStats.failed,
    };
  } catch (err) {
    console.warn('[sync] syncNow failed:', (err as Error).message);
    return empty;
  } finally {
    inFlight = false;
  }
}
