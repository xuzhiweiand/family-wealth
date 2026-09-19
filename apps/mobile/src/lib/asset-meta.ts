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
      .filter((s) => s.assetId === asset.id)
      .sort((x, y) => (x.capturedAt < y.capturedAt ? 1 : -1));
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
