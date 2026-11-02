import type { Asset, AssetSnapshot, AssetType, Visibility } from '@family-wealth/shared-types';
import { buildUpdateRows, groupUpdateRows, previewUpdateTotals } from '../lib/update-center';

const USER = 'user-1';
// 固定 ref = 2026-11-15，避免依赖运行日期
const REF = new Date(2026, 10, 15, 12, 0, 0);

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

let seq = 0;
function makeSnapshot(assetId: string, capturedAt: string, amount = 100_000): AssetSnapshot {
  seq += 1;
  return { id: `snap-${seq}`, assetId, familyId: 'fam-1', amount, currency: 'CNY', capturedAt, source: 'manual' };
}

describe('buildUpdateRows', () => {
  it('取最新快照金额与日期；本月快照标记 updatedThisMonth', () => {
    const a = makeAsset({ id: 'a1' });
    const rows = buildUpdateRows(
      [a],
      [
        makeSnapshot('a1', '2026-10-20T12:00:00.000Z', 80_000),
        makeSnapshot('a1', '2026-11-05T12:00:00.000Z', 120_000),
      ],
      REF,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lastAmount: 120_000,
      lastDate: '2026-11-05',
      updatedThisMonth: true,
    });
  });

  it('无快照时回落 currentAmount，lastDate 为 null', () => {
    const a = makeAsset({ currentAmount: 50_000 });
    const rows = buildUpdateRows([a], [], REF);
    expect(rows[0]).toMatchObject({ lastAmount: 50_000, lastDate: null, updatedThisMonth: false });
  });

  it('最新快照在上月时 updatedThisMonth=false', () => {
    const a = makeAsset({ id: 'a1' });
    const rows = buildUpdateRows([a], [makeSnapshot('a1', '2026-10-31T12:00:00.000Z', 90_000)], REF);
    expect(rows[0]!.updatedThisMonth).toBe(false);
    expect(rows[0]!.lastDate).toBe('2026-10-31');
  });

  it('快照日期乱序时仍取最新一条', () => {
    const a = makeAsset({ id: 'a1' });
    const rows = buildUpdateRows(
      [a],
      [
        makeSnapshot('a1', '2026-11-10T12:00:00.000Z', 130_000),
        makeSnapshot('a1', '2026-09-10T12:00:00.000Z', 70_000),
      ],
      REF,
    );
    expect(rows[0]!.lastAmount).toBe(130_000);
  });
});

describe('groupUpdateRows', () => {
  it('按类型顺序分组，债务在最后，空类型不出现', () => {
    const assets = [
      makeAsset({ id: 'd1', type: 'debt', name: '房贷' }),
      makeAsset({ id: 'b1', type: 'bank_deposit', name: '存款' }),
      makeAsset({ id: 's1', type: 'stock', name: '股票' }),
    ];
    const groups = groupUpdateRows(buildUpdateRows(assets, [], REF));
    expect(groups.map((g) => g.type)).toEqual(['bank_deposit', 'stock', 'debt']);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[2]!.label).toBe('债务');
  });

  it('组内保持入参顺序', () => {
    const assets = [
      makeAsset({ id: 'b1', name: '招行' }),
      makeAsset({ id: 'b2', name: '工行' }),
    ];
    const groups = groupUpdateRows(buildUpdateRows(assets, [], REF));
    expect(groups[0]!.rows.map((r) => r.asset.name)).toEqual(['招行', '工行']);
  });

  it('空输入返回空数组', () => {
    expect(groupUpdateRows([])).toEqual([]);
  });
});

describe('previewUpdateTotals', () => {
  it('已填金额替代上次值，未填沿用，债务计入负债绝对值', () => {
    const assets = [
      makeAsset({ id: 'a1', currentAmount: 100_000 }),
      makeAsset({ id: 'd1', type: 'debt', currentAmount: 50_000 }),
    ];
    const rows = buildUpdateRows(assets, [], REF);
    const values = new Map<string, number>([['a1', 120_000], ['d1', 40_000]]);
    expect(previewUpdateTotals(rows, values)).toEqual({
      totalAssets: 120_000,
      totalLiabilities: 40_000,
      netWorth: 80_000,
    });
  });

  it('空 values 时按上次金额计算', () => {
    const assets = [
      makeAsset({ id: 'a1', currentAmount: 60_000 }),
      makeAsset({ id: 'd1', type: 'debt', currentAmount: 20_000 }),
    ];
    const rows = buildUpdateRows(assets, [], REF);
    expect(previewUpdateTotals(rows, new Map())).toEqual({
      totalAssets: 60_000,
      totalLiabilities: 20_000,
      netWorth: 40_000,
    });
  });
});
