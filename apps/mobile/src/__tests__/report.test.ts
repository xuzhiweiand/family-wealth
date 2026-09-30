import type { Asset, AssetSnapshot } from '@family-wealth/shared-types';
import { buildMonthTotals } from '../lib/asset-meta';
import { buildMonthlyReportHtml, buildYearlyReportHtml } from '../lib/report-html';
import {
  availableMonths,
  availableYears,
  buildMonthlyReport,
  buildYearlyReport,
} from '../lib/report';

/** 本地时刻 → ISO（避免时区导致的月份漂移，与 buildMonthTotals 本地口径一致） */
function iso(y: number, m: number, d: number, h = 10): string {
  return new Date(y, m - 1, d, h).toISOString();
}

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    familyId: 'f1',
    ownerId: 'u1',
    type: 'bank_deposit',
    name: '招商银行卡',
    currentAmount: 123456,
    currency: 'CNY',
    visibility: 'family',
    details: {},
    createdAt: iso(2025, 1, 1),
    updatedAt: iso(2026, 9, 30, 8),
    deletedAt: null,
    ...overrides,
  };
}

function makeSnap(assetId: string, amount: number, capturedAt: string, id = ''): AssetSnapshot {
  return {
    id: id || `${assetId}-${capturedAt}`,
    assetId,
    familyId: 'f1',
    amount,
    currency: 'CNY',
    capturedAt,
    source: 'manual',
  };
}

describe('availableMonths / availableYears', () => {
  it('按月/年去重升序，口径为本地时区', () => {
    const snaps = [
      makeSnap('a1', 1, iso(2026, 9, 1)),
      makeSnap('a1', 2, iso(2026, 9, 20)),
      makeSnap('a1', 3, iso(2026, 7, 15)),
      makeSnap('a1', 4, iso(2025, 12, 31, 23)),
    ];
    expect(availableMonths(snaps)).toEqual(['2025-12', '2026-07', '2026-09']);
    expect(availableYears(snaps)).toEqual(['2025', '2026']);
  });
});

describe('buildMonthlyReport', () => {
  const assets = [
    makeAsset({ id: 'a1', type: 'bank_deposit', name: '招行', currentAmount: 999999 }),
    makeAsset({ id: 'a2', type: 'fund', name: '基金', currentAmount: 888888 }),
    makeAsset({ id: 'a3', type: 'debt', name: '房贷', currentAmount: -100 }),
  ];

  it('三卡与 buildMonthTotals 完全一致（月度台账口径）', () => {
    const snapshots = [
      makeSnap('a1', 100000, iso(2026, 9, 5)),
      makeSnap('a2', 50000, iso(2026, 9, 6)),
      makeSnap('a3', -40000, iso(2026, 9, 7)),
      // 往月快照不计入当月
      makeSnap('a1', 111111, iso(2026, 8, 5)),
    ];
    const ref = new Date(2026, 8, 15);
    const report = buildMonthlyReport(assets, snapshots, ref);
    expect(report.month).toBe('2026-09');
    expect(report.hasData).toBe(true);
    expect(report.totals).toEqual(buildMonthTotals(assets, snapshots, ref));
    expect(report.totals).toEqual({ totalAssets: 150000, totalLiabilities: 40000, netWorth: 110000 });
  });

  it('环比：上月有数据给 delta/pct，无数据给 null 占位', () => {
    const withPrev = [
      makeSnap('a1', 100000, iso(2026, 9, 5)),
      makeSnap('a1', 80000, iso(2026, 8, 5)),
    ];
    const r1 = buildMonthlyReport(assets, withPrev, new Date(2026, 8, 15));
    expect(r1.prevMonth).toBe('2026-08');
    expect(r1.netWorthDelta).toBe(20000);
    expect(r1.netWorthPct).toBeCloseTo(25);

    const noPrev = [makeSnap('a1', 100000, iso(2026, 9, 5))];
    const r2 = buildMonthlyReport(assets, noPrev, new Date(2026, 8, 15));
    expect(r2.prevMonth).toBeNull();
    expect(r2.prevTotals).toBeNull();
    expect(r2.netWorthDelta).toBeNull();
    expect(r2.netWorthPct).toBeNull();
  });

  it('同日重录/修正：后写入的快照胜出（三卡与明细口径一致）', () => {
    const snapshots = [
      makeSnap('a1', 100000, iso(2026, 9, 5, 9)),
      makeSnap('a1', 120000, iso(2026, 9, 5, 9)), // 同刻后写入
    ];
    const report = buildMonthlyReport(assets, snapshots, new Date(2026, 8, 15));
    expect(report.totals?.totalAssets).toBe(120000);
    // 明细两行都在，后写入的排前
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]?.amount).toBe(120000);
  });

  it('配置分布用当月最新快照金额，而非 currentAmount；债务单独给 debtAmount', () => {
    const snapshots = [
      makeSnap('a1', 100000, iso(2026, 9, 5)),
      makeSnap('a2', 100000, iso(2026, 9, 6)),
      makeSnap('a3', -50000, iso(2026, 9, 7)),
    ];
    const report = buildMonthlyReport(assets, snapshots, new Date(2026, 8, 15));
    expect(report.positiveTotal).toBe(200000);
    expect(report.debtAmount).toBe(50000);
    expect(report.slices.map((s) => s.amount).sort((x, y) => y - x)).toEqual([100000, 100000]);
    // currentAmount（999999/888888）不泄漏进切片
    expect(report.slices.every((s) => s.amount === 100000)).toBe(true);
  });

  it('快照明细只含当月、按录入时间倒序；口径外资产（不在列表）被排除', () => {
    const snapshots = [
      makeSnap('a1', 1, iso(2026, 9, 3)),
      makeSnap('a1', 2, iso(2026, 9, 8)),
      makeSnap('a1', 3, iso(2026, 8, 28)), // 上月
      makeSnap('ghost', 4, iso(2026, 9, 8)), // 资产不在传入列表
    ];
    const report = buildMonthlyReport(assets, snapshots, new Date(2026, 8, 15));
    expect(report.rows.map((r) => r.amount)).toEqual([2, 1]);
    expect(report.rows[0]?.assetName).toBe('招行');
    expect(report.rows[0]?.typeLabel).toBe('银行存款');
  });

  it('无快照月份：hasData=false，三卡/环比/分布/明细全部占位', () => {
    const report = buildMonthlyReport(assets, [], new Date(2026, 8, 15));
    expect(report.hasData).toBe(false);
    expect(report.totals).toBeNull();
    expect(report.slices).toEqual([]);
    expect(report.rows).toEqual([]);
  });

  it('当月快照全部属于口径外资产时视为无数据（不出现全 0 假报表）', () => {
    const snapshots = [makeSnap('ghost', 99999, iso(2026, 9, 5))];
    const report = buildMonthlyReport(assets, snapshots, new Date(2026, 8, 15));
    expect(report.hasData).toBe(false);
    expect(report.totals).toBeNull();
  });

  it('软删资产的历史快照仍计入对应月份', () => {
    const archived = makeAsset({ id: 'a9', name: '旧卡', deletedAt: iso(2026, 9, 20) });
    const snapshots = [makeSnap('a9', 777, iso(2026, 9, 5))];
    const report = buildMonthlyReport([...assets, archived], snapshots, new Date(2026, 8, 15));
    expect(report.totals?.totalAssets).toBe(777);
  });
});

describe('report HTML', () => {
  const assets = [makeAsset({ id: 'a1', name: '招行<工资卡>' })];
  const generatedAt = new Date(2026, 8, 30, 12, 0);

  it('月报 HTML：自包含、转义资产名、含三卡与明细', () => {
    const report = buildMonthlyReport(
      assets,
      [makeSnap('a1', 123456, iso(2026, 9, 5))],
      new Date(2026, 8, 15),
    );
    const html = buildMonthlyReportHtml(report, { generatedAt });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style>');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('招行&lt;工资卡&gt;');
    expect(html).toContain('¥1,234.56');
    expect(html).toContain('上月无数据，暂无环比');
  });

  it('月报无数据：占位说明，不出现错误数字', () => {
    const html = buildMonthlyReportHtml(
      buildMonthlyReport(assets, [], new Date(2026, 8, 15)),
      { generatedAt },
    );
    expect(html).toContain('本月还没有快照数据');
    expect(html).not.toContain('¥0.00');
  });

  it('年报 HTML：含年初年末对比、月趋势、大事记', () => {
    const report = buildYearlyReport(
      [makeAsset({ id: 'a1', name: '招行<工资卡>', createdAt: iso(2026, 2, 1) })],
      [makeSnap('a1', 100000, iso(2026, 3, 5)), makeSnap('a1', 150000, iso(2026, 9, 5))],
      2026,
      new Date(2026, 8, 30),
    );
    const html = buildYearlyReportHtml(report, { generatedAt });
    expect(html).toContain('年初年末对比');
    expect(html).toContain('月度趋势');
    expect(html).toContain('年度大事记');
    expect(html).toContain('新增');
    expect(html).toContain('+¥500.00');
  });
});

describe('buildYearlyReport', () => {
  const assets = [
    makeAsset({ id: 'a1', type: 'bank_deposit', name: '招行', createdAt: iso(2024, 3, 1) }),
    makeAsset({ id: 'a2', type: 'fund', name: '基金', createdAt: iso(2026, 5, 10) }),
    makeAsset({ id: 'a3', type: 'debt', name: '车贷', createdAt: iso(2023, 1, 1), deletedAt: iso(2026, 8, 1) }),
  ];
  const now = new Date(2026, 8, 30);

  it('年初/年末 = 当年第一个与最后一个有快照的月份，变化量正确', () => {
    const snapshots = [
      makeSnap('a1', 100000, iso(2026, 3, 5)),
      makeSnap('a1', 150000, iso(2026, 9, 5)),
      makeSnap('a2', 30000, iso(2026, 9, 6)),
      makeSnap('a1', 999999, iso(2025, 12, 5)), // 去年不计入
    ];
    const report = buildYearlyReport(assets, snapshots, 2026, now);
    expect(report.hasData).toBe(true);
    expect(report.beginMonth).toBe('2026-03');
    expect(report.endMonth).toBe('2026-09');
    expect(report.beginTotals?.netWorth).toBe(100000);
    expect(report.endTotals?.netWorth).toBe(180000);
    expect(report.netWorthDelta).toBe(80000);
    expect(report.netWorthPct).toBeCloseTo(80);
  });

  it('月趋势按月分桶、只含有数据的月份，终点不越过 now', () => {
    const snapshots = [
      makeSnap('a1', 100000, iso(2026, 3, 5)),
      makeSnap('a1', 150000, iso(2026, 9, 5)),
    ];
    const report = buildYearlyReport(assets, snapshots, 2026, now);
    const months = report.monthlyTrend.map((p) => p.date);
    expect(months[0]).toBe('2026-03');
    expect(months[months.length - 1]).toBe('2026-09');
    expect(months).not.toContain('2026-10');
    // 3~9 月 carry-forward 连续
    expect(months).toHaveLength(7);
    expect(report.monthlyTrend[report.monthlyTrend.length - 1]?.netWorth).toBe(150000);
  });

  it('年度大事记：当年新增/归档资产按时间升序；其他年份事件不混入', () => {
    const report = buildYearlyReport(assets, [], 2026, now);
    expect(report.events).toEqual([
      { kind: 'added', at: iso(2026, 5, 10), assetName: '基金', typeLabel: '基金' },
      { kind: 'archived', at: iso(2026, 8, 1), assetName: '车贷', typeLabel: '债务' },
    ]);
  });

  it('Top Movers：年内首末快照对比，按 |delta| 降序取 3；补录乱序仍按时间排序', () => {
    const mk = (id: string, name: string) =>
      makeAsset({ id, name, type: 'stock', createdAt: iso(2024, 1, 1) });
    const list = [mk('m1', '茅台'), mk('m2', '宁德'), mk('m3', '比亚迪'), mk('m4', '隆基')];
    const snapshots = [
      // m1: +90000（后写入的是补录的旧日期，last 仍是 9 月那条）
      makeSnap('m1', 100000, iso(2026, 9, 5)),
      makeSnap('m1', 10000, iso(2026, 2, 5)),
      // m2: -50000
      makeSnap('m2', 80000, iso(2026, 1, 5)),
      makeSnap('m2', 30000, iso(2026, 6, 5)),
      // m3: +20000
      makeSnap('m3', 10000, iso(2026, 4, 5)),
      makeSnap('m3', 30000, iso(2026, 7, 5)),
      // m4: 只有一条 → 不参与
      makeSnap('m4', 5000, iso(2026, 5, 5)),
    ];
    const report = buildYearlyReport(list, snapshots, 2026, now);
    expect(report.topMovers.map((m) => m.assetName)).toEqual(['茅台', '宁德', '比亚迪']);
    expect(report.topMovers[0]?.delta).toBe(90000);
    expect(report.topMovers[0]?.firstAmount).toBe(10000);
    expect(report.topMovers[0]?.lastAmount).toBe(100000);
    expect(report.topMovers[1]?.delta).toBe(-50000);
  });

  it('整年无数据：hasData=false，全部占位', () => {
    const snapshots = [makeSnap('a1', 1, iso(2025, 6, 1))];
    const report = buildYearlyReport(assets, snapshots, 2026, now);
    expect(report.hasData).toBe(false);
    expect(report.beginMonth).toBeNull();
    expect(report.endMonth).toBeNull();
    expect(report.netWorthDelta).toBeNull();
    expect(report.monthlyTrend).toEqual([]);
    expect(report.topMovers).toEqual([]);
    // 大事记仍按资产字段给出（与快照无关）
    expect(report.events).toHaveLength(2);
  });
});
