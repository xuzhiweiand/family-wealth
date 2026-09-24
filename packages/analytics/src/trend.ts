/**
 * 趋势聚合
 *
 * 趋势图的唯一数据源是 `asset_snapshots`（ADR / 数据模型 §C6）：每次金额变更写一条快照。
 * 本模块把「离散、稀疏、多资产的快照流」聚合成「按日历日的连续三线序列」。
 *
 * 三个关键语义（写死在这里，避免各端实现不一致）：
 *
 * 1. **同日多快照取最新** — 同一资产同一天改了 3 次金额，当天只认最后一次。
 * 2. **缺失日前向填充（carry-forward）** — 某资产 D5 有快照、D6~D9 没有，
 *    则 D6~D9 沿用 D5 的值（钱不会凭空消失，这是净值曲线的正确画法）。
 *    轴起点之前无记录的资产按 0 计（那时它还没建）。
 * 3. **口径 = 传入的 assets 列表** — 快照里出现但不在 assets 中的 assetId 一律忽略，
 *    这样软删资产只需调用方不传进来，就自动从历史净值里消失。
 */

import { LIABILITY_TYPES, type Asset, type AssetSnapshot, type TrendPoint } from '@family-wealth/shared-types';
import { pctChange } from '@family-wealth/shared-utils';
import { MAX_TREND_POINTS, assertValidRange, enumerateDateKeys, formatDateKey, parseDateKey, toDateKey } from './date-utils';

const DAY_MS = 86_400_000;

export interface TrendSeriesOptions {
  /** 只统计该家庭（不传则不按家庭过滤） */
  familyId?: string;
  /** 窗口起点（'YYYY-MM-DD' 或 ISO datetime） */
  from?: string;
  /** 窗口终点（同上） */
  to?: string;
  /**
   * 缺失日期是否前向填充，默认 true。
   * 关掉后无快照的日期该资产按 0 计（一般只在调试时用）。
   */
  carryForward?: boolean;
  /** 日期轴点数上限，默认 MAX_TREND_POINTS */
  maxPoints?: number;
}

interface DailyRecord {
  capturedAt: string;
  amount: number;
}

/**
 * 把快照流聚合成趋势三线序列（升序）。
 *
 * 窗口语义（重要）：`from` 之前的快照**不会**被丢弃，而是作为 carry-forward 的基线，
 * 否则窗口第一天的净值会从 0 起跳、画出一条假的暴涨曲线。
 *
 * @param snapshots 快照（不要求有序）
 * @param assets 参与统计的资产（决定负债判定与统计口径）
 */
export function buildTrendSeries(
  snapshots: readonly AssetSnapshot[],
  assets: readonly Asset[],
  options: TrendSeriesOptions = {},
): TrendPoint[] {
  const familyId = options.familyId;
  const carryForward = options.carryForward ?? true;
  const maxPoints = options.maxPoints ?? MAX_TREND_POINTS;
  const fromKey = options.from ? toDateKey(options.from) : null;
  const toKey = options.to ? toDateKey(options.to) : null;
  if (fromKey !== null && toKey !== null) assertValidRange(fromKey, toKey, maxPoints);

  const liabilityIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const a of assets) {
    assetIds.add(a.id);
    if (LIABILITY_TYPES.includes(a.type)) liabilityIds.add(a.id);
  }
  if (assetIds.size === 0) return [];

  // assetId -> dateKey -> 当日最新一条
  const perAsset = new Map<string, Map<string, DailyRecord>>();
  // 窗口起点之前每资产的最新值，作为 carry-forward 基线
  const baseline = new Map<string, DailyRecord>();

  let minKey: string | null = null;
  let maxKey: string | null = null;

  for (const s of snapshots) {
    if (familyId !== undefined && s.familyId !== familyId) continue;
    if (!assetIds.has(s.assetId)) continue;

    const key = toDateKey(s.capturedAt);
    if (toKey !== null && key > toKey) continue;

    if (fromKey !== null && key < fromKey) {
      // 窗口之前：只用来定基线，不进日期轴
      const prevBase = baseline.get(s.assetId);
      if (!prevBase || s.capturedAt > prevBase.capturedAt) {
        baseline.set(s.assetId, { capturedAt: s.capturedAt, amount: s.amount });
      }
      continue;
    }

    if (minKey === null || key < minKey) minKey = key;
    if (maxKey === null || key > maxKey) maxKey = key;

    let byDate = perAsset.get(s.assetId);
    if (!byDate) {
      byDate = new Map();
      perAsset.set(s.assetId, byDate);
    }
    const prev = byDate.get(key);
    // 同日多快照：保留 capturedAt 最大的那条；capturedAt 相同（同日重录/修正）
    // 时后写入的胜出 —— 快照数组按写入顺序追加，>= 让后者覆盖前者
    if (!prev || s.capturedAt >= prev.capturedAt) {
      byDate.set(key, { capturedAt: s.capturedAt, amount: s.amount });
    }
  }

  // 窗口内没有快照、且没有可填充的基线 → 没有可画的轴
  if (minKey === null && (fromKey === null || toKey === null)) return [];

  const axis = enumerateDateKeys(fromKey ?? minKey!, toKey ?? maxKey!, maxPoints);
  const totalAssets = new Array<number>(axis.length).fill(0);
  const totalLiabilities = new Array<number>(axis.length).fill(0);

  // 参与计算的资产 = 窗口内有快照的 ∪ 窗口前有基线的
  const involved = new Set<string>([...perAsset.keys(), ...baseline.keys()]);
  for (const assetId of involved) {
    const isLiability = liabilityIds.has(assetId);
    const byDate = perAsset.get(assetId);
    let carried = baseline.get(assetId)?.amount ?? 0; // 轴起点之前该资产尚不存在则按 0
    for (let i = 0; i < axis.length; i++) {
      const rec = byDate?.get(axis[i]!);
      if (rec) carried = rec.amount;
      const value = rec ? rec.amount : carryForward ? carried : 0;
      if (isLiability) {
        totalLiabilities[i] = totalLiabilities[i]! + Math.abs(value);
      } else {
        totalAssets[i] = totalAssets[i]! + value;
      }
    }
  }

  return axis.map((date, i) => {
    const a = totalAssets[i]!;
    const l = totalLiabilities[i]!;
    return { date, totalAssets: a, totalLiabilities: l, netWorth: a - l };
  });
}

/** 单个资产的金额时间序列（资产详情页迷你图用） */
export function buildAssetSeries(
  snapshots: readonly AssetSnapshot[],
  assetId: string,
  options: { from?: string; to?: string; carryForward?: boolean; maxPoints?: number } = {},
): Array<{ date: string; amount: number }> {
  const carryForward = options.carryForward ?? true;
  const maxPoints = options.maxPoints ?? MAX_TREND_POINTS;
  const fromKey = options.from ? toDateKey(options.from) : null;
  const toKey = options.to ? toDateKey(options.to) : null;

  const byDate = new Map<string, DailyRecord>();
  // 窗口起点之前的最新值，作为 carry-forward 基线（避免窗口首日从 0 起跳）
  let baseline: DailyRecord | null = null;

  let minKey: string | null = null;
  let maxKey: string | null = null;

  for (const s of snapshots) {
    if (s.assetId !== assetId) continue;
    const key = toDateKey(s.capturedAt);
    if (toKey !== null && key > toKey) continue;
    if (fromKey !== null && key < fromKey) {
      if (!baseline || s.capturedAt > baseline.capturedAt) {
        baseline = { capturedAt: s.capturedAt, amount: s.amount };
      }
      continue;
    }
    if (minKey === null || key < minKey) minKey = key;
    if (maxKey === null || key > maxKey) maxKey = key;
    const prev = byDate.get(key);
    // 同日同 capturedAt 时后写入的胜出（与 buildTrendSeries 口径一致）
    if (!prev || s.capturedAt >= prev.capturedAt) {
      byDate.set(key, { capturedAt: s.capturedAt, amount: s.amount });
    }
  }

  if (minKey === null && (fromKey === null || toKey === null)) return [];
  if (byDate.size === 0 && baseline === null) return [];

  const axis = enumerateDateKeys(fromKey ?? minKey!, toKey ?? maxKey!, maxPoints);
  let carried = baseline?.amount ?? 0;
  return axis.map((date) => {
    const rec = byDate.get(date);
    if (rec) carried = rec.amount;
    return { date, amount: rec ? rec.amount : carryForward ? carried : 0 };
  });
}

export interface TrendSummary {
  /** 序列最后一点（最新净值） */
  latest: TrendPoint | null;
  /** 对比基准点（lookbackDays 个日历日之前；够不着就取序列首点） */
  baseline: TrendPoint | null;
  /** 净资产变化（分，正=涨） */
  changeAmount: number;
  /** 净资产变化百分比（保留两位） */
  changePct: number;
}

/**
 * 汇总趋势序列，给出仪表盘要的「最新净值 + 环比」。
 *
 * @param lookbackDays 对比窗口（日历日），默认 30
 */
export function summarizeTrend(series: readonly TrendPoint[], lookbackDays = 30): TrendSummary {
  if (series.length === 0) {
    return { latest: null, baseline: null, changeAmount: 0, changePct: 0 };
  }
  const latest = series[series.length - 1]!;
  const targetKey = formatDateKey(parseDateKey(latest.date) - lookbackDays * DAY_MS);

  // 从后往前找第一个 date <= targetKey 的点
  let baseline: TrendPoint = series[0]!;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]!.date <= targetKey) {
      baseline = series[i]!;
      break;
    }
  }

  const changeAmount = latest.netWorth - baseline.netWorth;
  return {
    latest,
    baseline,
    changeAmount,
    changePct: pctChange(latest.netWorth, baseline.netWorth),
  };
}
