import type { Asset, AssetSnapshot, AssetType, TrendPoint, Visibility } from '@family-wealth/shared-types';
import {
  buildAssetMonthlySeries,
  buildDisplayMonthTotals,
  buildMonthGrowthLabels,
  buildMonthlyAssetDetails,
  groupSnapshotsByMonth,
} from '../lib/asset-meta';

const USER = 'user-1';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    familyId: 'fam-1',
    ownerId: USER,
    type: 'bank_deposit' as AssetType,
    name: '测试账户',
    currentAmount: 100_000,
    currency: 'CNY',
    visibility: 'family' as Visibility,
    details: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

let snapSeq = 0;
/** 快照时间统一取月中 UTC 正午，避免时区导致的月份归属偏差 */
function makeSnapshot(assetId: string, capturedAt: string, amount = 100_000): AssetSnapshot {
  snapSeq += 1;
  return {
    id: `snap-${snapSeq}`,
    assetId,
    familyId: 'fam-1',
    amount,
    currency: 'CNY',
    capturedAt,
    source: 'manual',
  };
}

// ref 固定为 2026-11-15，避免依赖运行当天日期
const REF = new Date(2026, 10, 15, 12, 0, 0);

describe('buildDisplayMonthTotals', () => {
  it('当月有快照时取当月，fallback=false', () => {
    const a = makeAsset();
    const r = buildDisplayMonthTotals(
      [a],
      [makeSnapshot(a.id, '2026-11-10T12:00:00.000Z', 500_000)],
      REF,
    );
    expect(r.month).toBe('2026-11');
    expect(r.fallback).toBe(false);
    expect(r.netWorth).toBe(500_000);
  });

  it('当月无快照时回退到最近一次有数据的月份', () => {
    const a = makeAsset();
    const r = buildDisplayMonthTotals(
      [a],
      [
        makeSnapshot(a.id, '2026-08-10T12:00:00.000Z', 300_000),
        makeSnapshot(a.id, '2026-10-10T12:00:00.000Z', 400_000),
      ],
      REF,
    );
    expect(r.month).toBe('2026-10');
    expect(r.fallback).toBe(true);
    expect(r.netWorth).toBe(400_000);
  });

  it('完全无快照时展示当月全 0，fallback=false', () => {
    const a = makeAsset();
    const r = buildDisplayMonthTotals([a], [], REF);
    expect(r.month).toBe('2026-11');
    expect(r.fallback).toBe(false);
    expect(r.netWorth).toBe(0);
  });

  it('未来月份的快照不参与回退', () => {
    const a = makeAsset();
    const r = buildDisplayMonthTotals(
      [a],
      [makeSnapshot(a.id, '2026-12-10T12:00:00.000Z', 900_000)],
      REF,
    );
    expect(r.month).toBe('2026-11');
    expect(r.fallback).toBe(false);
    expect(r.netWorth).toBe(0);
  });

  it('不属于资产列表的快照不计入当月判定', () => {
    const a = makeAsset({ id: 'a1' });
    const r = buildDisplayMonthTotals(
      [a],
      [makeSnapshot('other-asset', '2026-11-10T12:00:00.000Z', 900_000)],
      REF,
    );
    expect(r.month).toBe('2026-11');
    expect(r.fallback).toBe(false);
    expect(r.netWorth).toBe(0);
  });
});

describe('buildMonthGrowthLabels', () => {
  const series: TrendPoint[] = [
    { date: '2026-05', totalAssets: 0, totalLiabilities: 0, netWorth: 1_000_000 },
    { date: '2026-06', totalAssets: 0, totalLiabilities: 0, netWorth: 1_100_000 },
    { date: '2026-07', totalAssets: 0, totalLiabilities: 0, netWorth: 990_000 },
  ];

  it('取末尾 count 个点，窗口首点用序列前驱计算增长', () => {
    const labels = buildMonthGrowthLabels(series, 2);
    expect(labels.map((l) => l.key)).toEqual(['2026-06', '2026-07']);
    expect(labels[0]).toMatchObject({ delta: 100_000, pct: 10 });
    expect(labels[1]!.delta).toBe(-110_000);
    expect(labels[1]!.pct!).toBeCloseTo(-10, 5);
  });

  it('序列第一个点没有前驱：delta/pct 均为 null', () => {
    const labels = buildMonthGrowthLabels(series, 3);
    expect(labels[0]).toMatchObject({ key: '2026-05', delta: null, pct: null });
  });

  it('前驱为 0 时 delta 有值、pct 为 null', () => {
    const s: TrendPoint[] = [
      { date: '2026-05', totalAssets: 0, totalLiabilities: 0, netWorth: 0 },
      { date: '2026-06', totalAssets: 0, totalLiabilities: 0, netWorth: 500 },
    ];
    const labels = buildMonthGrowthLabels(s, 2);
    expect(labels[1]).toMatchObject({ delta: 500, pct: null });
  });
});

describe('buildAssetMonthlySeries', () => {
  it('每月取当月最新快照；缺月沿用上月值', () => {
    const a = makeAsset();
    const series = buildAssetMonthlySeries(
      a.id,
      [
        makeSnapshot(a.id, '2026-07-10T12:00:00.000Z', 100_000),
        makeSnapshot(a.id, '2026-08-05T12:00:00.000Z', 120_000),
        makeSnapshot(a.id, '2026-08-20T12:00:00.000Z', 130_000), // 同月更新，后者胜出
        makeSnapshot(a.id, '2026-10-10T12:00:00.000Z', 150_000),
      ],
      REF,
      6,
    );
    expect(series.map((p) => [p.date, p.netWorth])).toEqual([
      ['2026-06', null],
      ['2026-07', 100_000],
      ['2026-08', 130_000],
      ['2026-09', 130_000], // carry-forward
      ['2026-10', 150_000],
      ['2026-11', 150_000], // carry-forward
    ].filter(([, v]) => v !== null));
  });

  it('窗口之前的快照作为基线填入窗口首月', () => {
    const a = makeAsset();
    const series = buildAssetMonthlySeries(
      a.id,
      [makeSnapshot(a.id, '2026-01-10T12:00:00.000Z', 80_000)],
      REF,
      6,
    );
    expect(series).toHaveLength(6);
    expect(series[0]).toMatchObject({ date: '2026-06', netWorth: 80_000 });
    expect(series[5]).toMatchObject({ date: '2026-11', netWorth: 80_000 });
  });

  it('没有任何快照时返回空序列', () => {
    const a = makeAsset();
    expect(buildAssetMonthlySeries(a.id, [], REF, 6)).toEqual([]);
  });

  it('只统计本资产的快照', () => {
    const a = makeAsset({ id: 'a1' });
    const series = buildAssetMonthlySeries(
      a.id,
      [makeSnapshot('a2', '2026-10-10T12:00:00.000Z', 999_000)],
      REF,
      6,
    );
    expect(series).toEqual([]);
  });
});

describe('groupSnapshotsByMonth', () => {
  it('按年月分组并保持倒序，组头带条数', () => {
    const a = makeAsset();
    const groups = groupSnapshotsByMonth([
      makeSnapshot(a.id, '2026-10-20T12:00:00.000Z'),
      makeSnapshot(a.id, '2026-10-10T12:00:00.000Z'),
      makeSnapshot(a.id, '2026-09-10T12:00:00.000Z'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['2026年10月', '2026年9月']);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toHaveLength(1);
  });

  it('空列表返回空数组', () => {
    expect(groupSnapshotsByMonth([])).toEqual([]);
  });
});

describe('buildMonthlyAssetDetails', () => {
  it('逐月列出当月有快照的资产，含债务负数行与较上月增减', () => {
    const fund = makeAsset({ id: 'fund', type: 'fund' });
    const loan = makeAsset({ id: 'loan', type: 'debt' });
    const assets = [fund, loan];
    const snapshots = [
      makeSnapshot('fund', '2026-09-10T12:00:00.000Z', 100_000),
      makeSnapshot('fund', '2026-10-10T12:00:00.000Z', 120_000),
      makeSnapshot('loan', '2026-10-10T12:00:00.000Z', 50_000),
    ];
    const details = buildMonthlyAssetDetails(assets, snapshots, REF, 12);

    // 倒序：10 月在前；9 月只有 fund；11 月无数据被跳过
    expect(details.map((d) => d.month)).toEqual(['2026-10', '2026-09']);

    const oct = details[0]!;
    expect(oct.rows).toHaveLength(2);
    // 债务行金额为负
    const loanRow = oct.rows.find((r) => r.asset.id === 'loan')!;
    expect(loanRow.amount).toBe(-50_000);
    expect(loanRow.delta).toBeNull(); // 上月无快照
    // fund 行 delta 相对 9 月
    const fundRow = oct.rows.find((r) => r.asset.id === 'fund')!;
    expect(fundRow.delta).toBe(20_000);
    // 月合计与月际增减
    expect(oct.netWorth).toBe(70_000);
    expect(oct.delta).toBe(-30_000); // 9 月合计 100_000
    expect(oct.pct).toBeCloseTo(-30, 5);

    const sep = details[1]!;
    expect(sep.rows).toHaveLength(1);
    expect(sep.netWorth).toBe(100_000);
    expect(sep.delta).toBeNull(); // 更早月份无数据
  });

  it('同月多条快照取最新一条', () => {
    const a = makeAsset();
    const details = buildMonthlyAssetDetails(
      [a],
      [
        makeSnapshot(a.id, '2026-10-05T12:00:00.000Z', 100_000),
        makeSnapshot(a.id, '2026-10-20T12:00:00.000Z', 130_000),
      ],
      REF,
      12,
    );
    expect(details[0]!.rows[0]!.amount).toBe(130_000);
  });

  it('完全无数据时返回空数组', () => {
    expect(buildMonthlyAssetDetails([makeAsset()], [], REF, 12)).toEqual([]);
  });
});
