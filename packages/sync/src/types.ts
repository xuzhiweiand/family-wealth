/**
 * 同步层类型
 *
 * 端到端加密背景下（ADR-0006），服务端只能看到：
 *   id / kind / updated_at / deleted_at / envelope(密文)
 * 也就是下面的 RemoteRow —— 明文金额、资产名、备注统统不可见。
 * 趋势聚合只能在客户端做，这也是 packages/analytics 存在的原因。
 */

import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';

/** 可同步的记录类型 */
export type SyncKind = 'asset' | 'snapshot';

/** 明文同步记录（内存中，绝不落服务端） */
export type SyncPayload = Asset | AssetSnapshot;

export interface SyncRecord<T extends SyncPayload = SyncPayload> {
  id: string;
  kind: SyncKind;
  updatedAt: string;
  deletedAt: string | null;
  payload: T;
}

/** 上下行的最小单元：密文 + 用于增量/冲突裁决的元数据 */
export interface RemoteRow {
  id: string;
  kind: SyncKind;
  updatedAt: string;
  deletedAt: string | null;
  /** serializeEnvelope 产物（{v,iv,tag,ct} 的 JSON） */
  envelope: string;
}

export interface PushAck {
  id: string;
  ok: boolean;
  error?: string;
}

/** 远端存储抽象（Supabase / 内存 mock / 未来的自托管，皆可替换） */
export interface RemoteAdapter {
  /** 拉取 updatedAt > since 的行；since 为 null 表示全量 */
  pull(since: string | null, kinds: readonly SyncKind[]): Promise<RemoteRow[]>;
  push(rows: readonly RemoteRow[]): Promise<PushAck[]>;
}

/** 本地待上行队列（与 packages/db 的 SyncQueue 结构化兼容） */
export interface SyncQueueEntry {
  id: string;
  table: string;
  recordId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  createdAt: string;
  retries: number;
}

export interface QueuePort {
  pending(): SyncQueueEntry[] | Promise<SyncQueueEntry[]>;
  markDone(id: string): void | Promise<void>;
  markFailed(id: string): void | Promise<void>;
}

/** 资产落库端口（AssetRepository 天然满足） */
export interface AssetPort {
  findById(id: string): Promise<Asset | null>;
  upsert(asset: Asset): Promise<void>;
}

/** 快照落库端口（append-only + 墓碑删除，需要 has 做幂等） */
export interface SnapshotPort {
  has(id: string): Promise<boolean>;
  append(snapshot: AssetSnapshot): Promise<void>;
  /** 处理下行删除墓碑（deleted_at 非空的快照行） */
  remove(id: string): Promise<void>;
}

export interface PullStats {
  /** 拉到的行数 */
  pulled: number;
  /** 真正写入本地的行数 */
  applied: number;
  /** 因本地更新而保留本地、未写入的行数 */
  conflicts: number;
  /** 解密失败（被篡改 / 密钥不对）的行数 */
  failed: number;
}

export interface PushStats {
  pushed: number;
  failed: number;
}

export interface SyncStats extends PullStats, PushStats {}
