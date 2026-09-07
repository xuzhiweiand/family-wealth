import type { Asset, AssetSnapshot, AssetType } from '@family-wealth/shared-types';
import { buildAssetSeries, buildTrendSeries, summarizeTrend } from '../trend';

let seq = 0;

function snap(assetId: string, date: string, amount: number, opts?: { familyId?: string; time?: string }): AssetSnapshot {
  return {
    id: `s${++seq}`,
    assetId,
    familyId: opts?.familyId ?? 'f1',
    amount,
    currency: 'CNY',
    capturedAt: `${date}T${opts?.time ?? '10:00'}:00.000Z`,
    source: 'manual',
  };
}

function asset(id: string, type: AssetType = 'bank_deposit'): Asset {
  return {
    id,
    familyId: 'f1',
    ownerId: 'u1',
    type,
    name: id,
    currentAmount: 0,
    currency: 'CNY',
    visibility: 'family',
    details: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
  };
}

describe('buildTrendSeries', () => {
  it('returns empty for no snapshots', () => {
    expect(buildTrendSeries([], [asset('a1')])).toEqual([]);
  });

  it('returns empty for no assets (口径以 assets 为准)', () => {
    expect(buildTrendSeries([snap('a1', '2026-09-01', 100)], [])).toEqual([]);
  });

  it('builds a single point for a single snapshot', () => {
    const series = buildTrendSeries([snap('a1', '2026-09-01', 100_00)], [asset('a1')]);
    expect(series).toEqual([
      { date: '2026-09-01', totalAssets: 100_00, totalLiabilities: 0, netWorth: 100_00 },
    ]);
  });

  it('keeps only the latest snapshot of the same day (同日多改取最新)', () => {
    const series = buildTrendSeries(
      [
        snap('a1', '2026-09-01', 100_00, { time: '09:00' }),
        snap('a1', '2026-09-01', 300_00, { time: '15:00' }),
        snap('a1', '2026-09-01', 200_00, { time: '12:00' }),
      ],
      [asset('a1')],
    );
    expect(series).toHaveLength(1);
    expect(series[0]!.totalAssets).toBe(300_00);
  });

  it('carries forward missing days (缺失日前向填充)', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-05', 500_00)],
      [asset('a1')],
    );
    expect(series.map((p) => p.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(series.map((p) => p.totalAssets)).toEqual([100_00, 100_00, 100_00, 100_00, 500_00]);
  });

  it('treats days before an asset existed as zero', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a2', '2026-09-03', 50_00)],
      [asset('a1'), asset('a2')],
    );
    expect(series.map((p) => p.totalAssets)).toEqual([100_00, 100_00, 150_00]);
  });

  it('can disable carry-forward', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-03', 300_00)],
      [asset('a1')],
      { carryForward: false },
    );
    expect(series.map((p) => p.totalAssets)).toEqual([100_00, 0, 300_00]);
  });

  it('subtracts liabilities from net worth', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 1000_00), snap('d1', '2026-09-01', 300_00)],
      [asset('a1'), asset('d1', 'debt')],
    );
    expect(series[0]).toEqual({
      date: '2026-09-01',
      totalAssets: 1000_00,
      totalLiabilities: 300_00,
      netWorth: 700_00,
    });
  });

  it('treats liabilities stored as negative amounts as positive liabilities', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 1000_00), snap('d1', '2026-09-01', -300_00)],
      [asset('a1'), asset('d1', 'debt')],
    );
    expect(series[0]!.totalLiabilities).toBe(300_00);
    expect(series[0]!.netWorth).toBe(700_00);
  });

  it('ignores snapshots of assets not in the asset list (软删资产自动出局)', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('gone', '2026-09-01', 9999_00)],
      [asset('a1')],
    );
    expect(series[0]!.totalAssets).toBe(100_00);
  });

  it('filters by familyId', () => {
    const series = buildTrendSeries(
      [
        snap('a1', '2026-09-01', 100_00, { familyId: 'f1' }),
        snap('a2', '2026-09-01', 500_00, { familyId: 'f2' }),
      ],
      [asset('a1'), asset('a2')],
      { familyId: 'f1' },
    );
    expect(series[0]!.totalAssets).toBe(100_00);
  });

  it('clips to the from/to window while keeping carry-forward from before it', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-10', 900_00)],
      [asset('a1')],
      { from: '2026-09-08', to: '2026-09-10' },
    );
    expect(series.map((p) => p.date)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    // 窗口起点之前的最新值是 09-01 的 100_00
    expect(series.map((p) => p.totalAssets)).toEqual([100_00, 100_00, 900_00]);
  });

  it('produces an ascending axis regardless of input order', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-03', 300_00), snap('a1', '2026-09-01', 100_00)],
      [asset('a1')],
    );
    expect(series.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(series.map((p) => p.totalAssets)).toEqual([100_00, 100_00, 300_00]);
  });

  it('aggregates many assets on the same day', () => {
    const series = buildTrendSeries(
      [
        snap('a1', '2026-09-01', 100_00),
        snap('a2', '2026-09-01', 200_00),
        snap('a3', '2026-09-01', 300_00),
      ],
      [asset('a1'), asset('a2'), asset('a3')],
    );
    expect(series[0]!.totalAssets).toBe(600_00);
    expect(series[0]!.netWorth).toBe(600_00);
  });

  it('throws when the requested window exceeds maxPoints', () => {
    expect(() =>
      buildTrendSeries([snap('a1', '2026-09-01', 1)], [asset('a1')], {
        from: '2000-01-01',
        to: '2026-01-01',
      }),
    ).toThrow(/date range too large/);
  });
});

describe('buildAssetSeries', () => {
  it('returns empty when the asset has no snapshots', () => {
    expect(buildAssetSeries([snap('a1', '2026-09-01', 1)], 'nope')).toEqual([]);
  });

  it('carries forward for a single asset', () => {
    const series = buildAssetSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-04', 400_00)],
      'a1',
    );
    expect(series.map((p) => p.amount)).toEqual([100_00, 100_00, 100_00, 400_00]);
  });

  it('respects from/to', () => {
    const series = buildAssetSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-05', 500_00)],
      'a1',
      { from: '2026-09-04', to: '2026-09-05' },
    );
    expect(series.map((p) => p.date)).toEqual(['2026-09-04', '2026-09-05']);
    expect(series.map((p) => p.amount)).toEqual([100_00, 500_00]);
  });
});

describe('summarizeTrend', () => {
  it('handles an empty series', () => {
    const s = summarizeTrend([]);
    expect(s.latest).toBeNull();
    expect(s.baseline).toBeNull();
    expect(s.changeAmount).toBe(0);
    expect(s.changePct).toBe(0);
  });

  it('falls back to the first point when the series is shorter than the lookback', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 100_00), snap('a1', '2026-09-03', 150_00)],
      [asset('a1')],
    );
    const s = summarizeTrend(series, 30);
    expect(s.latest!.netWorth).toBe(150_00);
    expect(s.baseline!.date).toBe('2026-09-01');
    expect(s.changeAmount).toBe(50_00);
    expect(s.changePct).toBeCloseTo(50, 2);
  });

  it('picks the baseline lookbackDays before the latest point', () => {
    const series = buildTrendSeries(
      [
        snap('a1', '2026-09-01', 100_00),
        snap('a1', '2026-09-11', 200_00),
        snap('a1', '2026-09-30', 300_00),
      ],
      [asset('a1')],
    );
    expect(series).toHaveLength(30);
    const s = summarizeTrend(series, 10);
    expect(s.latest!.date).toBe('2026-09-30');
    expect(s.baseline!.date).toBe('2026-09-20');
    // 09-20 前向填充自 09-11 → 200_00
    expect(s.baseline!.netWorth).toBe(200_00);
    expect(s.changeAmount).toBe(100_00);
    expect(s.changePct).toBeCloseTo(50, 2);
  });

  it('reports a negative change when net worth drops', () => {
    const series = buildTrendSeries(
      [snap('a1', '2026-09-01', 300_00), snap('a1', '2026-09-05', 150_00)],
      [asset('a1')],
    );
    const s = summarizeTrend(series, 3);
    expect(s.changeAmount).toBe(-150_00);
    expect(s.changePct).toBeCloseTo(-50, 2);
  });
});
