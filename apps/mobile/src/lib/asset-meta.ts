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

/** 本地时区月份 key：'YYYY-MM'（与 buildMonthTotals 的归属口径一致） */
export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface DisplayMonthTotals extends MonthTotals {
  /** 实际取数月份 'YYYY-MM' */
  month: string;
  /** true = 当月无任何快照，回退到了最近一次有数据的月份 */
  fallback: boolean;
}

/**
 * 总览净资产卡的取数口径（0.3.0）：优先取 ref 当月；
 * 当月没有任何快照时，回退到最近一次有快照的月份并标记 fallback，
 * 让卡片展示「最近一次的数据」而不是全 0。未来月份的快照不参与回退。
 */
export function buildDisplayMonthTotals(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  ref: Date = new Date(),
): DisplayMonthTotals {
  const current = monthKeyOf(ref);
  const assetIds = new Set(assets.map((a) => a.id));
  let latestPast: string | null = null;
  let hasCurrent = false;
  for (const s of snapshots) {
    if (!assetIds.has(s.assetId)) continue;
    const key = monthKeyOf(new Date(s.capturedAt));
    if (key === current) {
      hasCurrent = true;
    } else if (key < current && (latestPast === null || key > latestPast)) {
      latestPast = key;
    }
  }

  const month = hasCurrent || latestPast === null ? current : latestPast;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const totals = buildMonthTotals(assets, snapshots, new Date(y, m - 1, 15));
  return { ...totals, month, fallback: !hasCurrent && latestPast !== null };
}

export interface MonthGrowthLabel {
  /** 月份 key 'YYYY-MM' */
  key: string;
  /** 相对前一个月的变化额（分）；序列第一个点没有前驱时为 null */
  delta: number | null;
  /** 相对前一个月的变化百分比；前驱为 0 / 不存在时为 null */
  pct: number | null;
}

/**
 * 月度序列 → 每月增长标签：取序列末尾 count 个点展示，
 * 每个点的 delta/pct 相对它在完整序列中的前一个点计算
 * （所以窗口第一个展示点也能算出增长，只要它前面还有数据）。
 */
export function buildMonthGrowthLabels(
  series: readonly TrendPoint[],
  count: number,
  key: 'netWorth' | 'totalAssets' | 'totalLiabilities' = 'netWorth',
): MonthGrowthLabel[] {
  const start = Math.max(0, series.length - count);
  const out: MonthGrowthLabel[] = [];
  for (let i = start; i < series.length; i++) {
    const cur = series[i]!;
    const prev = i > 0 ? series[i - 1]! : null;
    if (prev === null || prev[key] === 0) {
      out.push({ key: cur.date, delta: prev === null ? null : cur[key] - prev[key], pct: null });
    } else {
      const delta = cur[key] - prev[key];
      out.push({ key: cur.date, delta, pct: (delta / Math.abs(prev[key])) * 100 });
    }
  }
  return out;
}

/**
 * 单笔资产的近 N 个月月度序列（详情页趋势弹层用）：
 * 每月取当月最新一条快照（同 capturedAt 后写入胜出），
 * 当月没有快照时沿用上月的值（carry-forward，与三线趋势图同口径）；
 * 窗口之前有历史快照时作为基线填入窗口第一个月。
 * 返回点的 date 为月份 key 'YYYY-MM'，金额放在 netWorth 字段（单线复用 TrendChart）。
 */
export function buildAssetMonthlySeries(
  assetId: string,
  snapshots: readonly AssetSnapshot[],
  ref: Date = new Date(),
  monthCount = 6,
): TrendPoint[] {
  const base = new Date(ref.getFullYear(), ref.getMonth() - (monthCount - 1), 1);
  const months: string[] = [];
  for (let i = 0; i < monthCount; i++) {
    months.push(monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }

  // 月份 -> 当月最新快照金额；窗口前最新一条作为基线
  const byMonth = new Map<string, number>();
  let baseline: number | null = null;
  let baselineAt = '';
  for (const s of snapshots) {
    if (s.assetId !== assetId) continue;
    const key = monthKeyOf(new Date(s.capturedAt));
    if (key < months[0]!) {
      if (baseline === null || s.capturedAt >= baselineAt) {
        baseline = s.amount;
        baselineAt = s.capturedAt;
      }
      continue;
    }
    byMonth.set(key, s.amount); // 快照数组按写入序追加，后者覆盖前者
  }

  const out: TrendPoint[] = [];
  let value = baseline;
  for (const month of months) {
    const v = byMonth.get(month);
    if (v !== undefined) value = v;
    if (value === null) continue; // 还没有任何数据的开头月份不画
    out.push({ date: month, totalAssets: value, totalLiabilities: 0, netWorth: value });
  }
  return out;
}

export interface SnapshotMonthGroup {
  /** 月份 key 'YYYY-MM' */
  month: string;
  /** 展示文案，如 '2026年10月' */
  label: string;
  items: AssetSnapshot[];
}

/**
 * 快照列表按「年-月」分组（详情页用）。
 * 输入需已按 capturedAt 倒序排好，分组保持该顺序（新月份在前、组内新条目在前）。
 */
export function groupSnapshotsByMonth(snapshots: readonly AssetSnapshot[]): SnapshotMonthGroup[] {
  const groups: SnapshotMonthGroup[] = [];
  const index = new Map<string, SnapshotMonthGroup>();
  for (const s of snapshots) {
    const d = new Date(s.capturedAt);
    const month = monthKeyOf(d);
    let g = index.get(month);
    if (g === undefined) {
      g = { month, label: `${d.getFullYear()}年${d.getMonth() + 1}月`, items: [] };
      index.set(month, g);
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}

export interface MonthAssetRow {
  asset: Asset;
  /** 当月最新快照金额（分）；债务以负数展示 */
  amount: number;
  /** 相对该资产上月最新快照的变化额（分）；上月无快照时为 null */
  delta: number | null;
}

export interface MonthAssetDetail {
  /** 月份 key 'YYYY-MM' */
  month: string;
  /** 当月合计净资产（分）：正向资产合计 - 债务合计 */
  netWorth: number;
  /** 相对上月合计的变化额（分）；上月无数据时为 null */
  delta: number | null;
  /** 相对上月合计的变化百分比；上月无数据 / 为 0 时为 null */
  pct: number | null;
  rows: MonthAssetRow[];
}

/**
 * 趋势页「资产详情」模块（0.3.0）：近 N 个月逐月列出各资产数据。
 * 口径与月度台账一致 —— 只统计当月有快照的资产（每笔取当月最新一条），
 * 当月无快照的资产不出现在该月；没有任伺数据的月份整月跳过。
 * 返回按月份倒序（最新在前）；多算一个月作为最老展示月的 delta 基数。
 */
export function buildMonthlyAssetDetails(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  ref: Date = new Date(),
  monthCount = 12,
): MonthAssetDetail[] {
  // 月份（含基数月，共 monthCount+1 个，升序） -> assetId -> 当月最新快照金额
  const base = new Date(ref.getFullYear(), ref.getMonth() - monthCount, 1);
  const months: string[] = [];
  for (let i = 0; i <= monthCount; i++) {
    months.push(monthKeyOf(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }

  const amountOf = new Map<string, Map<string, number>>();
  for (const s of snapshots) {
    const key = monthKeyOf(new Date(s.capturedAt));
    if (key < months[0]! || key > months[months.length - 1]!) continue;
    let byAsset = amountOf.get(key);
    if (byAsset === undefined) {
      byAsset = new Map();
      amountOf.set(key, byAsset);
    }
    byAsset.set(s.assetId, s.amount); // 写入序后者胜出（同 buildMonthTotals 的 >= 口径）
  }

  const out: MonthAssetDetail[] = [];
  // months 升序，最老一个是基数月不展示；展示月倒序压入 out
  for (let i = months.length - 1; i >= 1; i--) {
    const month = months[i]!;
    const byAsset = amountOf.get(month);
    if (byAsset === undefined || byAsset.size === 0) continue;
    const prevByAsset = amountOf.get(months[i - 1]!);

    let netWorth = 0;
    const rows: MonthAssetRow[] = [];
    for (const a of assets) {
      const raw = byAsset.get(a.id);
      if (raw === undefined) continue;
      const amount = a.type === 'debt' ? -Math.abs(raw) : raw;
      const prevRaw = prevByAsset?.get(a.id);
      const delta =
        prevRaw === undefined ? null : amount - (a.type === 'debt' ? -Math.abs(prevRaw) : prevRaw);
      netWorth += amount;
      rows.push({ asset: a, amount, delta });
    }

    let delta: number | null = null;
    let pct: number | null = null;
    if (prevByAsset !== undefined && prevByAsset.size > 0) {
      let prevNet = 0;
      for (const a of assets) {
        const raw = prevByAsset.get(a.id);
        if (raw === undefined) continue;
        prevNet += a.type === 'debt' ? -Math.abs(raw) : raw;
      }
      delta = netWorth - prevNet;
      pct = prevNet !== 0 ? (delta / Math.abs(prevNet)) * 100 : null;
    }

    rows.sort((x, y) => y.amount - x.amount);
    out.push({ month, netWorth, delta, pct, rows });
  }
  return out;
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
