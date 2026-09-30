/**
 * 月度 / 年度资产报表（P0-5）
 *
 * 纯逻辑装配，数字口径与主页 / 月度台账完全一致：
 * - 月报三卡直接复用 buildMonthTotals（只统计当月有快照的资产、取当月最新快照）；
 * - 配置分布用「当月最新快照金额」重写资产金额后走 buildCategorySlices；
 * - 年报趋势复用 buildTrendSeries 后按月分桶（每桶取桶内最后一点，carry-forward）；
 * - 年度大事记 = 年内新增 / 归档资产事件 + 金额变化 Top 3（年内首末快照对比），
 *   全部可从快照与资产字段溯源。
 *
 * 数据不足的月份 / 指标返回 null 或空数组，由 UI 展示占位说明，不显示错误数字。
 * 可见性口径：调用方必须传入 filterVisibleAssets 过滤后的资产（含软删，
 * 软删资产的历史快照仍计入对应月份——它当时还存在）。
 */

import { buildTrendSeries } from '@family-wealth/analytics';
import type { Asset, AssetSnapshot, TrendPoint } from '@family-wealth/shared-types';
import { pctChange } from '@family-wealth/shared-utils';
import {
  ASSET_TYPE_LABELS,
  buildCategorySlices,
  buildMonthTotals,
  type CategorySlice,
  type MonthTotals,
} from './asset-meta';

/** 'YYYY-MM'（本地时区，与 buildMonthTotals 同口径） */
function monthKeyOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyOfIso(iso: string): string {
  return monthKeyOfDate(new Date(iso));
}

/**
 * 按资产口径收敛快照：只保留传入资产（可见性过滤后）的快照。
 * 报表内所有统计（hasData / 期间列表 / 三卡 / 明细 / 趋势）都建立在口径内快照上，
 * 避免出现「该月快照全是他人的私有资产 → 报表全 0」的假数据页。
 */
export function scopeSnapshots(
  snapshots: readonly AssetSnapshot[],
  assets: readonly Asset[],
): AssetSnapshot[] {
  const ids = new Set(assets.map((a) => a.id));
  return snapshots.filter((s) => ids.has(s.assetId));
}

/** 有快照数据的月份（'YYYY-MM' 升序去重）——报表期间切换的可选范围 */
export function availableMonths(snapshots: readonly AssetSnapshot[]): string[] {
  const set = new Set<string>();
  for (const s of snapshots) set.add(monthKeyOfIso(s.capturedAt));
  return [...set].sort();
}

/** 有快照数据的年份（'YYYY' 升序去重） */
export function availableYears(snapshots: readonly AssetSnapshot[]): string[] {
  const set = new Set<string>();
  for (const s of snapshots) set.add(String(new Date(s.capturedAt).getFullYear()));
  return [...set].sort();
}

/** 当月每资产最新快照（capturedAt 最大；同日同刻后写入胜出，与 buildMonthTotals 同口径） */
function bestMonthSnapshotMap(
  snapshots: readonly AssetSnapshot[],
  month: string,
): Map<string, AssetSnapshot> {
  const best = new Map<string, AssetSnapshot>();
  for (const s of snapshots) {
    if (monthKeyOfIso(s.capturedAt) !== month) continue;
    const prev = best.get(s.assetId);
    if (!prev || s.capturedAt >= prev.capturedAt) best.set(s.assetId, s);
  }
  return best;
}

/** 用当月最新快照金额重写资产金额（buildCategorySlices 的输入） */
function assetsWithMonthAmounts(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  month: string,
): Asset[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: Asset[] = [];
  for (const [assetId, snap] of bestMonthSnapshotMap(snapshots, month)) {
    const a = byId.get(assetId);
    if (a) out.push({ ...a, currentAmount: snap.amount });
  }
  return out;
}

function monthRef(month: string): Date {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

export interface MonthSnapshotRow {
  assetId: string;
  assetName: string;
  typeLabel: string;
  /** 金额（分） */
  amount: number;
  capturedAt: string;
  source: AssetSnapshot['source'];
}

export interface MonthlyReport {
  month: string;
  hasData: boolean;
  totals: MonthTotals | null;
  /** 上月月份与三卡；上月无快照时为 null（环比占位） */
  prevMonth: string | null;
  prevTotals: MonthTotals | null;
  /** 环比变化额（分）；无上月数据时为 null */
  netWorthDelta: number | null;
  assetsDelta: number | null;
  liabilitiesDelta: number | null;
  /** 净资产环比百分比；无上月数据或上月净资产为 0 时为 null */
  netWorthPct: number | null;
  /** 当月配置分布（债务单独给 debtAmount/debtShare，不在 slices 内） */
  slices: CategorySlice[];
  positiveTotal: number;
  debtAmount: number;
  debtShare: number;
  /** 本月快照明细（capturedAt 倒序；同日同刻后写入在前） */
  rows: MonthSnapshotRow[];
}

export function buildMonthlyReport(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  ref: Date,
): MonthlyReport {
  const scoped = scopeSnapshots(snapshots, assets);
  const month = monthKeyOfDate(ref);
  const hasData = bestMonthSnapshotMap(scoped, month).size > 0;
  const totals = hasData ? buildMonthTotals(assets, scoped, ref) : null;

  const prevRef = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const prevMonth = monthKeyOfDate(prevRef);
  const hasPrev = bestMonthSnapshotMap(scoped, prevMonth).size > 0;
  const prevTotals = hasPrev ? buildMonthTotals(assets, scoped, prevRef) : null;

  const cat = buildCategorySlices(assetsWithMonthAmounts(assets, scoped, month));

  const byId = new Map(assets.map((a) => [a.id, a]));
  const rows: MonthSnapshotRow[] = scoped
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => monthKeyOfIso(s.capturedAt) === month && byId.has(s.assetId))
    .sort((x, y) => {
      if (x.s.capturedAt !== y.s.capturedAt) return x.s.capturedAt < y.s.capturedAt ? 1 : -1;
      return y.i - x.i;
    })
    .map(({ s }) => {
      const a = byId.get(s.assetId)!;
      return {
        assetId: s.assetId,
        assetName: a.name,
        typeLabel: ASSET_TYPE_LABELS[a.type],
        amount: s.amount,
        capturedAt: s.capturedAt,
        source: s.source,
      };
    });

  return {
    month,
    hasData,
    totals,
    prevMonth: hasPrev ? prevMonth : null,
    prevTotals,
    netWorthDelta: totals !== null && prevTotals !== null ? totals.netWorth - prevTotals.netWorth : null,
    assetsDelta: totals !== null && prevTotals !== null ? totals.totalAssets - prevTotals.totalAssets : null,
    liabilitiesDelta:
      totals !== null && prevTotals !== null ? totals.totalLiabilities - prevTotals.totalLiabilities : null,
    netWorthPct:
      totals !== null && prevTotals !== null && prevTotals.netWorth !== 0
        ? pctChange(totals.netWorth, prevTotals.netWorth)
        : null,
    slices: cat.slices,
    positiveTotal: cat.positiveTotal,
    debtAmount: cat.debtAmount,
    debtShare: cat.debtShare,
    rows,
  };
}

export interface YearEvent {
  kind: 'added' | 'archived';
  at: string;
  assetName: string;
  typeLabel: string;
}

export interface TopMover {
  assetId: string;
  assetName: string;
  typeLabel: string;
  /** 年内首条快照金额（分） */
  firstAmount: number;
  /** 年内末条快照金额（分） */
  lastAmount: number;
  delta: number;
  pct: number;
}

export interface YearlyReport {
  year: string;
  hasData: boolean;
  /** 当年第一个 / 最后一个有快照的月份（'YYYY-MM'） */
  beginMonth: string | null;
  endMonth: string | null;
  beginTotals: MonthTotals | null;
  endTotals: MonthTotals | null;
  /** 年末相对年初变化；数据不足时为 null */
  netWorthDelta: number | null;
  assetsDelta: number | null;
  liabilitiesDelta: number | null;
  netWorthPct: number | null;
  /** 月分桶趋势（date='YYYY-MM'，只含有数据的月份） */
  monthlyTrend: TrendPoint[];
  /** 年初 / 年末配置分布 */
  beginSlices: CategorySlice[];
  endSlices: CategorySlice[];
  /** 年度大事记：年内新增 / 归档资产（时间升序） */
  events: YearEvent[];
  /** 金额变化 Top 3（年内首末快照对比，|delta| 降序） */
  topMovers: TopMover[];
}

export function buildYearlyReport(
  assets: readonly Asset[],
  snapshots: readonly AssetSnapshot[],
  year: number,
  now: Date = new Date(),
): YearlyReport {
  const yearStr = String(year);
  const scoped = scopeSnapshots(snapshots, assets);
  const months = availableMonths(scoped).filter((m) => m.startsWith(`${yearStr}-`));
  const hasData = months.length > 0;
  const beginMonth = hasData ? months[0]! : null;
  const endMonth = hasData ? months[months.length - 1]! : null;

  const totalsOf = (month: string) => buildMonthTotals(assets, scoped, monthRef(month));
  const beginTotals = beginMonth !== null ? totalsOf(beginMonth) : null;
  const endTotals = endMonth !== null ? totalsOf(endMonth) : null;

  // 月分桶趋势：从当年第一个有数据的月份画到年末（不越过今天），
  // 年初前不画 0 值平线 —— 开始记账前的月份无意义，且避免从 0 起跳的假暴涨曲线。
  let monthlyTrend: TrendPoint[] = [];
  if (hasData) {
    const to =
      now.getFullYear() === year
        ? `${yearStr}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        : `${yearStr}-12-31`;
    const daily = buildTrendSeries(scoped, assets, { from: `${beginMonth!}-01`, to });
    const byMonth = new Map<string, TrendPoint>();
    for (const p of daily) byMonth.set(p.date.slice(0, 7), p);
    monthlyTrend = [...byMonth.entries()].map(([key, p]) => ({ ...p, date: key }));
  }

  const slicesOf = (month: string | null): CategorySlice[] =>
    month === null ? [] : buildCategorySlices(assetsWithMonthAmounts(assets, scoped, month)).slices;

  // 大事记：新增 / 归档
  const inYear = (iso: string) => new Date(iso).getFullYear() === year;
  const events: YearEvent[] = [];
  for (const a of assets) {
    if (inYear(a.createdAt)) {
      events.push({ kind: 'added', at: a.createdAt, assetName: a.name, typeLabel: ASSET_TYPE_LABELS[a.type] });
    }
    if (a.deletedAt !== null && inYear(a.deletedAt)) {
      events.push({ kind: 'archived', at: a.deletedAt, assetName: a.name, typeLabel: ASSET_TYPE_LABELS[a.type] });
    }
  }
  events.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

  // Top Movers：年内每资产首末快照对比（capturedAt 升序；同日同刻后写入排后 → 成为 last）
  const byId = new Map(assets.map((a) => [a.id, a]));
  const perAsset = new Map<string, { s: AssetSnapshot; i: number }[]>();
  scoped.forEach((s, i) => {
    if (new Date(s.capturedAt).getFullYear() !== year) return;
    if (!byId.has(s.assetId)) return;
    let list = perAsset.get(s.assetId);
    if (!list) {
      list = [];
      perAsset.set(s.assetId, list);
    }
    list.push({ s, i });
  });
  const movers: TopMover[] = [];
  for (const [assetId, list] of perAsset) {
    if (list.length < 2) continue;
    list.sort((x, y) => {
      if (x.s.capturedAt !== y.s.capturedAt) return x.s.capturedAt < y.s.capturedAt ? -1 : 1;
      return x.i - y.i;
    });
    const first = list[0]!.s;
    const last = list[list.length - 1]!.s;
    const a = byId.get(assetId)!;
    movers.push({
      assetId,
      assetName: a.name,
      typeLabel: ASSET_TYPE_LABELS[a.type],
      firstAmount: first.amount,
      lastAmount: last.amount,
      delta: last.amount - first.amount,
      pct: pctChange(last.amount, first.amount),
    });
  }
  movers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    year: yearStr,
    hasData,
    beginMonth,
    endMonth,
    beginTotals,
    endTotals,
    netWorthDelta: beginTotals !== null && endTotals !== null ? endTotals.netWorth - beginTotals.netWorth : null,
    assetsDelta:
      beginTotals !== null && endTotals !== null ? endTotals.totalAssets - beginTotals.totalAssets : null,
    liabilitiesDelta:
      beginTotals !== null && endTotals !== null
        ? endTotals.totalLiabilities - beginTotals.totalLiabilities
        : null,
    netWorthPct:
      beginTotals !== null && endTotals !== null && beginTotals.netWorth !== 0
        ? pctChange(endTotals.netWorth, beginTotals.netWorth)
        : null,
    monthlyTrend,
    beginSlices: slicesOf(beginMonth),
    endSlices: slicesOf(endMonth),
    events,
    topMovers: movers.slice(0, 3),
  };
}
