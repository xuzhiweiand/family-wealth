/**
 * 月度盘点完成度（P0-1 月末盘点提醒的核心口径）
 *
 * 纯函数、无平台依赖，供 ReminderService 与单测共用。
 * 口径与 asset-meta.buildMonthTotals 严格对齐：
 * - 资产范围：未软删（deletedAt == null）且当前用户可见
 *   （visibility=family，或 ownerId=当前用户）；
 * - 完成条件：范围内每笔资产在目标月份（本地时区 YYYY-MM）至少有 1 条快照，
 *   capturedAt 落月即可——当月补录同样视为已盘点；
 * - 没有任何资产（total=0）时不进入提醒计划，complete 恒为 false。
 */

import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';

export interface InventoryStatus {
  /** 目标月份，本地时区 'YYYY-MM' */
  month: string;
  /** 纳入盘点范围的资产总数 */
  total: number;
  /** 当月已有快照的资产数 */
  done: number;
  /** 当月尚缺快照的资产（按传入顺序） */
  missing: Asset[];
  /** 全部资产都有当月快照，且至少有 1 个资产 */
  complete: boolean;
}

/** 本地时区月份键，与 buildMonthTotals 一致 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 资产是否在当前用户的盘点范围内 */
function isInScope(asset: Asset, userId: string): boolean {
  if (asset.deletedAt !== null) return false;
  return asset.visibility === 'family' || asset.ownerId === userId;
}

export function getInventoryStatus(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  userId: string,
  ref: Date = new Date(),
): InventoryStatus {
  const month = monthKey(ref);

  // 当月有快照的 assetId 集合（1 条即够，不关心同日裁决）
  const doneIds = new Set<string>();
  for (const s of snapshots) {
    if (monthKey(new Date(s.capturedAt)) === month) doneIds.add(s.assetId);
  }

  const scoped = assets.filter((a) => isInScope(a, userId));
  const missing = scoped.filter((a) => !doneIds.has(a.id));

  return {
    month,
    total: scoped.length,
    done: scoped.length - missing.length,
    missing,
    complete: scoped.length > 0 && missing.length === 0,
  };
}
