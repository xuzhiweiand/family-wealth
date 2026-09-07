/**
 * WatermelonDB 行记录 ↔ 领域类型 的纯映射函数
 *
 * 设计：WatermelonDB 的 Model._raw 是「蛇形命名的扁平行」（日期存 epoch ms，
 * details 存 JSON 字符串）。本模块把这种原始行与领域类型（camelCase + ISO 时间
 * 字符串 + details 对象）互转，不依赖 @nozbe/watermelondb，可被 jest 直接单测。
 *
 * 列命名约定（对齐 packages/db/src/watermelon/schema.ts）：
 *   assets:          family_id / owner_id / type / name / current_amount /
 *                    currency / visibility / details / created_at / updated_at / deleted_at
 *   asset_snapshots: asset_id / family_id / amount / currency / captured_at / source
 */

import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';

/** WatermelonDB `assets` 表原始行 */
export interface AssetRecord {
  id: string;
  family_id: string;
  owner_id: string;
  type: string;
  name: string;
  /** 金额（分，整数） */
  current_amount: number;
  currency: string;
  visibility: string;
  /** JSON 序列化的 details */
  details: string;
  /** epoch ms */
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** WatermelonDB `asset_snapshots` 表原始行 */
export interface AssetSnapshotRecord {
  id: string;
  asset_id: string;
  family_id: string;
  /** 金额（分，整数） */
  amount: number;
  currency: string;
  /** epoch ms */
  captured_at: number;
  source: string;
}

/** 安全解析 JSON 字符串；空值/损坏时返回 {}，避免本地缓存损坏导致崩溃 */
function safeParseJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** epoch ms → ISO 8601 字符串 */
function toISO(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** ISO 8601 字符串 → epoch ms */
function toEpoch(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** 原始行 → 领域 Asset */
export function toAsset(record: AssetRecord): Asset {
  return {
    id: record.id,
    familyId: record.family_id,
    ownerId: record.owner_id,
    type: record.type as Asset['type'],
    name: record.name,
    currentAmount: record.current_amount,
    currency: record.currency,
    visibility: record.visibility as Asset['visibility'],
    details: safeParseJson(record.details),
    createdAt: toISO(record.created_at),
    updatedAt: toISO(record.updated_at),
    deletedAt: record.deleted_at === null ? null : toISO(record.deleted_at),
  };
}

/** 领域 Asset → 原始行 */
export function toAssetRecord(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    family_id: asset.familyId,
    owner_id: asset.ownerId,
    type: asset.type,
    name: asset.name,
    current_amount: asset.currentAmount,
    currency: asset.currency,
    visibility: asset.visibility,
    details: JSON.stringify(asset.details ?? {}),
    created_at: toEpoch(asset.createdAt),
    updated_at: toEpoch(asset.updatedAt),
    deleted_at: asset.deletedAt === null ? null : toEpoch(asset.deletedAt),
  };
}

/** 原始行 → 领域 AssetSnapshot */
export function toSnapshot(record: AssetSnapshotRecord): AssetSnapshot {
  return {
    id: record.id,
    assetId: record.asset_id,
    familyId: record.family_id,
    amount: record.amount,
    currency: record.currency,
    capturedAt: toISO(record.captured_at),
    source: record.source as AssetSnapshot['source'],
  };
}

/** 领域 AssetSnapshot → 原始行 */
export function toSnapshotRecord(snapshot: AssetSnapshot): AssetSnapshotRecord {
  return {
    id: snapshot.id,
    asset_id: snapshot.assetId,
    family_id: snapshot.familyId,
    amount: snapshot.amount,
    currency: snapshot.currency,
    captured_at: toEpoch(snapshot.capturedAt),
    source: snapshot.source,
  };
}
