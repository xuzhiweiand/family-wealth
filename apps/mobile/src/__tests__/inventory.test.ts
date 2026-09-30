import type { Asset, AssetSnapshot, AssetType, Visibility } from '@family-wealth/shared-types';
import { getInventoryStatus, monthKey } from '../lib/inventory';

const USER = 'user-1';
const OTHER = 'user-2';

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

function makeSnapshot(assetId: string, capturedAt: string): AssetSnapshot {
  return {
    id: `snap-${assetId}-${capturedAt}`,
    assetId,
    familyId: 'fam-1',
    amount: 100_000,
    currency: 'CNY',
    capturedAt,
    source: 'manual',
  };
}

// ref 固定为 2026-09-15，避免依赖运行当天日期
const REF = new Date(2026, 8, 15, 12, 0, 0);

describe('monthKey', () => {
  it('补零格式为 YYYY-MM', () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12');
  });
});

describe('getInventoryStatus', () => {
  it('没有任何资产时 total=0、complete=false，不进入提醒计划', () => {
    const r = getInventoryStatus([], [], USER, REF);
    expect(r).toMatchObject({ month: '2026-09', total: 0, done: 0, complete: false });
    expect(r.missing).toEqual([]);
  });

  it('资产当月无快照时计入 missing，complete=false', () => {
    const a = makeAsset();
    const r = getInventoryStatus([a], [], USER, REF);
    expect(r.total).toBe(1);
    expect(r.done).toBe(0);
    expect(r.missing).toEqual([a]);
    expect(r.complete).toBe(false);
  });

  it('资产有当月快照时 done=1、complete=true', () => {
    const a = makeAsset();
    const r = getInventoryStatus([a], [makeSnapshot(a.id, '2026-09-01T12:00:00.000Z')], USER, REF);
    expect(r.done).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it('快照只有上月/下月时仍视为缺失（严格按月份归属）', () => {
    const a = makeAsset();
    const r = getInventoryStatus(
      [a],
      [
        makeSnapshot(a.id, '2026-08-31T00:00:00.000Z'), // 东八区 08-31 08:00 → 8 月
        makeSnapshot(a.id, '2026-10-01T00:00:00.000Z'), // 东八区 10-01 08:00 → 10 月
      ],
      USER,
      REF,
    );
    expect(r.done).toBe(0);
    expect(r.complete).toBe(false);
  });

  it('UTC 月末在本地时区跨月时按本地时区判定', () => {
    const a = makeAsset();
    // UTC 2026-09-30 16:00 = 本地 10-01 00:00（东八区）→ ref=9 月时缺失
    const r = getInventoryStatus([a], [makeSnapshot(a.id, '2026-09-30T16:00:00.000Z')], USER, REF);
    expect(r.missing).toEqual([a]);
    expect(r.complete).toBe(false);
  });

  it('软删资产不纳入盘点范围', () => {
    const deleted = makeAsset({ id: 'a-deleted', deletedAt: '2026-09-10T00:00:00.000Z' });
    const r = getInventoryStatus([deleted], [], USER, REF);
    expect(r.total).toBe(0);
    expect(r.complete).toBe(false);
  });

  it('私有资产：本人可见，他人不可见', () => {
    const mine = makeAsset({ id: 'a-mine', visibility: 'private' });
    const theirs = makeAsset({ id: 'a-theirs', visibility: 'private', ownerId: OTHER });

    const r = getInventoryStatus([mine, theirs], [], USER, REF);
    expect(r.total).toBe(1);
    expect(r.missing.map((a) => a.id)).toEqual(['a-mine']);
  });

  it('家庭可见资产无论归属都纳入范围', () => {
    const shared = makeAsset({ id: 'a-shared', ownerId: OTHER, visibility: 'family' });
    const r = getInventoryStatus([shared], [], USER, REF);
    expect(r.total).toBe(1);
    expect(r.missing.map((a) => a.id)).toEqual(['a-shared']);
  });

  it('多资产部分完成：done/missing 计数正确且不要求所有资产都有快照', () => {
    const a1 = makeAsset({ id: 'a1' });
    const a2 = makeAsset({ id: 'a2' });
    const a3 = makeAsset({ id: 'a3' });
    const r = getInventoryStatus(
      [a1, a2, a3],
      [makeSnapshot('a2', '2026-09-05T00:00:00.000Z')],
      USER,
      REF,
    );
    expect(r.total).toBe(3);
    expect(r.done).toBe(1);
    expect(r.missing.map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(r.complete).toBe(false);
  });

  it('同月多条快照（同日重录）仍只算完成，不去重计数', () => {
    const a = makeAsset();
    const r = getInventoryStatus(
      [a],
      [
        makeSnapshot(a.id, '2026-09-01T00:00:00.000Z'),
        makeSnapshot(a.id, '2026-09-20T00:00:00.000Z'),
      ],
      USER,
      REF,
    );
    expect(r.done).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('其他月份 ref 下的完成度独立计算', () => {
    const a = makeAsset();
    const octRef = new Date(2026, 9, 15);
    const r = getInventoryStatus([a], [makeSnapshot(a.id, '2026-09-30T00:00:00.000Z')], USER, octRef);
    expect(r.month).toBe('2026-10');
    expect(r.missing).toEqual([a]);
  });
});
