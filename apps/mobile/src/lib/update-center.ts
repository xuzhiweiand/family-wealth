/**
 * 更新中心（v0.3.1）纯计算逻辑
 *
 * 一屏集中更新所有资产与债务：每行取「上次数据」（最新快照金额 + 记账日期），
 * 用户填入新值后可单条保存或批量提交。所有计算停留在本机（ADR-0006）。
 */

import type { Asset, AssetSnapshot, AssetType } from '@family-wealth/shared-types';
import {
  ASSET_TYPE_COLORS, ASSET_TYPE_LABELS, latestCapturedDateMap, latestSnapshotAmountMap, monthKeyOf,
  type MonthTotals,
} from './asset-meta';

/** 分组展示顺序：资产在前、债务最后（与列表/趋势页口径一致） */
const TYPE_ORDER: readonly AssetType[] = [
  'bank_deposit',
  'stock',
  'fund',
  'wealth_management',
  'real_estate',
  'vehicle',
  'cash',
  'crypto',
  'precious_metal',
  'receivable',
  'debt',
];

export interface UpdateRow {
  asset: Asset;
  /** 上次金额（分）：最新快照；无快照回落 currentAmount */
  lastAmount: number;
  /** 最新快照记账日期 'YYYY-MM-DD'；无快照为 null */
  lastDate: string | null;
  /** 最新快照是否落在 ref 当月（用于「本月已更新」标记） */
  updatedThisMonth: boolean;
}

export interface UpdateGroup {
  type: AssetType;
  label: string;
  color: string;
  rows: UpdateRow[];
}

/** 每项资产的上次数据（快照口径）；按资产列表顺序输出 */
export function buildUpdateRows(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  ref: Date = new Date(),
): UpdateRow[] {
  const latestAmount = latestSnapshotAmountMap(snapshots);
  const latestDate = latestCapturedDateMap(snapshots);
  const currentMonth = monthKeyOf(ref);

  return assets.map((asset) => {
    const amount = latestAmount.get(asset.id);
    const date = latestDate.get(asset.id) ?? null;
    return {
      asset,
      lastAmount: amount ?? asset.currentAmount,
      lastDate: date,
      updatedThisMonth: date !== null && date.slice(0, 7) === currentMonth,
    };
  });
}

/** 按资产类型分组；空组不返回，组内保持入参顺序 */
export function groupUpdateRows(rows: readonly UpdateRow[]): UpdateGroup[] {
  const byType = new Map<AssetType, UpdateRow[]>();
  for (const row of rows) {
    const list = byType.get(row.asset.type);
    if (list === undefined) byType.set(row.asset.type, [row]);
    else list.push(row);
  }
  const out: UpdateGroup[] = [];
  for (const type of TYPE_ORDER) {
    const list = byType.get(type);
    if (list === undefined || list.length === 0) continue;
    out.push({ type, label: ASSET_TYPE_LABELS[type], color: ASSET_TYPE_COLORS[type], rows: list });
  }
  return out;
}

/**
 * 更新后合计预览：已填金额替代上次金额，未填沿用上次。
 * values 的 key 为资产 id，值为分；债务按绝对值计入负债。
 */
export function previewUpdateTotals(
  rows: readonly UpdateRow[],
  values: ReadonlyMap<string, number>,
): MonthTotals {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const row of rows) {
    const raw = values.get(row.asset.id) ?? row.lastAmount;
    if (row.asset.type === 'debt') totalLiabilities += Math.abs(raw);
    else totalAssets += raw;
  }
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}
