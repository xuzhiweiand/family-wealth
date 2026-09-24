/**
 * 资产展示领域元数据与本机聚合辅助
 *
 * - 统一 11 类资产的中文名 / 配色，供录入、详情、回收站、总览、趋势共用，
 *   避免同一个 Record 在多文件漂移。
 * - 分类占比、最近变化、峰值都在本机算（服务端只见密文，ADR-0006）。
 */

import type { Asset, AssetSnapshot, AssetType, TrendPoint } from '@family-wealth/shared-types';

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  cash: '现金',
  bank_deposit: '银行存款',
  stock: '股票',
  fund: '基金',
  wealth_management: '理财',
  real_estate: '房产',
  vehicle: '车辆',
  crypto: '数字货币',
  precious_metal: '贵金属',
  receivable: '债权',
  debt: '债务',
};

/** 环形图 / 条形对比用色（与原型同系） */
export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  cash: '#F59E0B',
  bank_deposit: '#3B82F6',
  stock: '#8B5CF6',
  fund: '#EC4899',
  wealth_management: '#06B6D4',
  real_estate: '#F97316',
  vehicle: '#84CC16',
  crypto: '#EAB308',
  precious_metal: '#D4AF37',
  receivable: '#14B8A6',
  debt: '#EF4444',
};

export interface CategorySlice {
  type: AssetType;
  label: string;
  color: string;
  /** 该类合计（分） */
  amount: number;
  /** 占总资产（正向）百分比 0-100 */
  pct: number;
}

/**
 * 把资产按类型聚合成环形图切片。
 *
 * 口径：债务不是总资产的组成部分——非债务类型按「占正向资产合计」给切片，
 * 债务单独用 debtShare 返回（占正向资产的比例，UI 加负号展示，对照原型）。
 */
export function buildCategorySlices(assets: readonly Asset[]): {
  slices: CategorySlice[];
  positiveTotal: number;
  debtAmount: number;
  debtShare: number;
} {
  const byType = new Map<AssetType, number>();
  let positiveTotal = 0;
  let debtAmount = 0;

  for (const a of assets) {
    if (a.type === 'debt') {
      debtAmount += Math.abs(a.currentAmount);
      continue;
    }
    positiveTotal += a.currentAmount;
    byType.set(a.type, (byType.get(a.type) ?? 0) + a.currentAmount);
  }

  const slices: CategorySlice[] = [...byType.entries()]
    .map(([type, amount]) => ({
      type,
      label: ASSET_TYPE_LABELS[type],
      color: ASSET_TYPE_COLORS[type],
      amount,
      pct: positiveTotal > 0 ? (amount / positiveTotal) * 100 : 0,
    }))
    .sort((x, y) => y.amount - x.amount);

  return {
    slices,
    positiveTotal,
    debtAmount,
    debtShare: positiveTotal > 0 ? (debtAmount / positiveTotal) * 100 : 0,
  };
}

export interface RecentChange {
  asset: Asset;
  /** 上一快照金额（分），无则 null */
  previousAmount: number | null;
  /** 变化额（分） */
  delta: number;
  /** 变化百分比 */
  pct: number;
  /** 最近一次更新时间 ISO */
  at: string;
  source: AssetSnapshot['source'];
}

/**
 * 计算每笔资产的最近一次变化（最新快照相对上一条快照）。
 * 只返回最近窗口内有更新、且能算出变化的条目，按时间倒序。
 *
 * 排序口径：capturedAt 降序；同 capturedAt（同日重录/修正）后写入的胜出
 * （快照数组按写入顺序追加，与 packages/analytics 的同日口径一致）。
 */
export function buildRecentChanges(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  windowDays = 7,
  limit = 5,
): RecentChange[] {
  const since = Date.now() - windowDays * 86_400_000;
  const out: RecentChange[] = [];

  for (const asset of assets) {
    const rows = snapshots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.assetId === asset.id)
      .sort((a, b) => {
        if (a.s.capturedAt !== b.s.capturedAt) {
          return a.s.capturedAt < b.s.capturedAt ? 1 : -1;
        }
        return b.i - a.i;
      })
      .map(({ s }) => s);
    const latest = rows[0];
    if (!latest) continue;
    if (Date.parse(latest.capturedAt) < since) continue;

    const prev = rows[1] ?? null;
    const base = prev?.amount ?? null;
    const delta = base === null ? 0 : latest.amount - base;
    const pct = base !== null && base !== 0 ? (delta / Math.abs(base)) * 100 : 0;
    out.push({ asset, previousAmount: base, delta, pct, at: latest.capturedAt, source: latest.source });
  }

  return out.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
}

export interface MonthTotals {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * 月度台账口径（0.1.3）：总览三卡（家庭净资产/总资产/总负债）只统计
 * ref 所在月份内有快照的资产，每笔资产取当月最新一条快照
 * （capturedAt 最大；同 capturedAt 后写入胜出）。
 * 当月无快照的资产不计入 —— 往月的历史录入不再被加总进当月卡片。
 */
export function buildMonthTotals(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  ref: Date = new Date(),
): MonthTotals {
  const month = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
  const best = new Map<string, AssetSnapshot>();
  for (const s of snapshots) {
    const d = new Date(s.capturedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key !== month) continue;
    const prev = best.get(s.assetId);
    if (!prev || s.capturedAt >= prev.capturedAt) best.set(s.assetId, s);
  }

  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const a of assets) {
    const snap = best.get(a.id);
    if (!snap) continue;
    if (a.type === 'debt') {
      totalLiabilities += Math.abs(snap.amount);
    } else {
      totalAssets += snap.amount;
    }
  }
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

/**
 * assetId -> 最新一条快照的录入日期（'YYYY-MM-DD'，本地时区口径由 capturedAt 决定）。
 * 供资产列表/最近变化展示「录入日期」用；无快照的资产不在 Map 中。
 */
export function latestCapturedDateMap(snapshots: readonly AssetSnapshot[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of snapshots) {
    const key = s.capturedAt.slice(0, 10);
    const prev = out.get(s.assetId);
    if (prev === undefined || key >= prev) out.set(s.assetId, key);
  }
  return out;
}

/**
 * assetId -> 最新一条快照的金额（分）。
 * 用于分类对比等需要「最新快照口径」的场景：用快照金额替代 asset.currentAmount。
 * 无快照的资产不在 Map 中（调用方决定是否回落到 currentAmount）。
 *
 * 口径：capturedAt 降序；同 capturedAt（同日重录/修正）后写入的胜出
 * （快照数组按写入序追加，与 packages/analytics 的同日口径一致）。
 */
export function latestSnapshotAmountMap(snapshots: readonly AssetSnapshot[]): Map<string, number> {
  const best = new Map<string, AssetSnapshot>();
  for (const s of snapshots) {
    const prev = best.get(s.assetId);
    if (!prev || s.capturedAt >= prev.capturedAt) best.set(s.assetId, s);
  }
  const out = new Map<string, number>();
  for (const [id, snap] of best) out.set(id, snap.amount);
  return out;
}

export interface PeakInfo {
  amount: number;
  date: string;
}

/** 序列中净资产最高点（金额并列时取最早日期） */
export function findPeak(series: readonly TrendPoint[]): PeakInfo | null {
  let peak: PeakInfo | null = null;
  for (const p of series) {
    if (peak === null || p.netWorth > peak.amount) {
      peak = { amount: p.netWorth, date: p.date };
    }
  }
  return peak;
}

/** 相对时间文案：「刚刚 / N 分钟前 / N 小时前 / N 天前」 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - Date.parse(iso);
  const min = 60_000;
  if (diff < min) return '刚刚';
  if (diff < 60 * min) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} 小时前`;
  return `${Math.floor(diff / (24 * 60 * min))} 天前`;
}
