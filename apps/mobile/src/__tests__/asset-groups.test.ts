/**
 * P0-4 资产分组纯逻辑测试：CRUD / 排序 / 小计口径 / 删除回落未分组 / 折叠切换
 */

import type { Asset } from '@family-wealth/shared-types';
import {
  createGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  sortGroups,
  groupAssets,
  getAssetGroupId,
  withGroupId,
  toggleCollapsed,
  type AssetGroup,
} from '../lib/asset-groups';

function makeGroup(id: string, name: string, order: number, createdAt = '2026-09-30T00:00:00.000Z'): AssetGroup {
  return { id, name, order, createdAt };
}

function makeAsset(id: string, type: Asset['type'], amount: number, groupId?: string): Asset {
  return {
    id,
    familyId: 'f1',
    ownerId: 'u1',
    type,
    name: `资产${id}`,
    currentAmount: amount,
    currency: 'CNY',
    visibility: 'family',
    details: groupId ? { groupId } : {},
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
  };
}

describe('createGroup', () => {
  it('追加到末尾并排序', () => {
    const g = createGroup([makeGroup('a', '银行', 0)], 'b', '投资');
    expect(g.map((x) => x.id)).toEqual(['a', 'b']);
    expect(g[1]!.order).toBe(1);
  });

  it('拒绝空名与重名', () => {
    expect(() => createGroup([], 'x', '  ')).toThrow('分组名称不能为空');
    expect(() => createGroup([makeGroup('a', '银行', 0)], 'x', '银行')).toThrow('已存在同名分组');
  });

  it('名称去空格', () => {
    const g = createGroup([], 'x', '  银行  ');
    expect(g[0]!.name).toBe('银行');
  });
});

describe('renameGroup', () => {
  const base = [makeGroup('a', '银行', 0), makeGroup('b', '投资', 1)];

  it('正常重命名', () => {
    const g = renameGroup(base, 'a', '存款');
    expect(g.find((x) => x.id === 'a')?.name).toBe('存款');
  });

  it('拒绝与他人重名 / 空名 / 不存在', () => {
    expect(() => renameGroup(base, 'a', '投资')).toThrow('已存在同名分组');
    expect(() => renameGroup(base, 'a', '')).toThrow('分组名称不能为空');
    expect(() => renameGroup(base, 'zzz', '新')).toThrow('分组不存在');
  });

  it('允许改成自己当前的名字（无变化）', () => {
    expect(() => renameGroup(base, 'a', '银行')).not.toThrow();
  });
});

describe('removeGroup', () => {
  it('只删配置', () => {
    expect(removeGroup([makeGroup('a', '银行', 0)], 'a')).toEqual([]);
  });
});

describe('moveGroup', () => {
  const base = [makeGroup('a', 'A', 0), makeGroup('b', 'B', 1), makeGroup('c', 'C', 2)];

  it('下移交换 order', () => {
    const g = moveGroup(base, 'a', 'down');
    expect(g.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('上移交换 order', () => {
    const g = moveGroup(base, 'c', 'up');
    expect(g.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('越界不动', () => {
    expect(moveGroup(base, 'a', 'up').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(moveGroup(base, 'c', 'down').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('sortGroups', () => {
  it('按 order 升序，同 order 按创建时间', () => {
    const g = sortGroups([
      makeGroup('b', 'B', 1),
      makeGroup('a', 'A', 0),
      makeGroup('c', 'C', 1, '2026-01-01T00:00:00.000Z'),
    ]);
    expect(g.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('getAssetGroupId / withGroupId', () => {
  it('读取归属；脏数据返回 null', () => {
    expect(getAssetGroupId(makeAsset('1', 'cash', 100, 'g1'))).toBe('g1');
    expect(getAssetGroupId(makeAsset('2', 'cash', 100))).toBeNull();
    const dirty = makeAsset('3', 'cash', 100);
    dirty.details = { groupId: 123 };
    expect(getAssetGroupId(dirty)).toBeNull();
  });

  it('withGroupId 设置与清除', () => {
    const d = withGroupId({ note: 'x' }, 'g1');
    expect(d['groupId']).toBe('g1');
    expect(d['note']).toBe('x');
    const cleared = withGroupId(d, null);
    expect(cleared['groupId']).toBeUndefined();
    expect(cleared['note']).toBe('x');
  });
});

describe('groupAssets', () => {
  const groups = [makeGroup('g1', '银行', 0), makeGroup('g2', '投资', 1)];

  it('按分组顺序聚合，未分组在最前', () => {
    const assets = [
      makeAsset('1', 'bank_deposit', 100_00, 'g1'),
      makeAsset('2', 'stock', 200_00, 'g2'),
      makeAsset('3', 'cash', 50_00),
    ];
    const sections = groupAssets(assets, groups);
    expect(sections.map((s) => s.key)).toEqual(['ungrouped', 'g1', 'g2']);
    expect(sections[0]!.data.map((a) => a.id)).toEqual(['3']);
  });

  it('小计口径：债务不计入资产合计，单独给负债合计（绝对值）', () => {
    const assets = [
      makeAsset('1', 'bank_deposit', 100_00, 'g1'),
      makeAsset('2', 'debt', -30_00, 'g1'),
      makeAsset('3', 'cash', 20_00, 'g1'),
    ];
    const s = groupAssets(assets, groups).find((x) => x.key === 'g1')!;
    expect(s.assetTotal).toBe(120_00);
    expect(s.debtTotal).toBe(30_00);
  });

  it('删除分组后资产自动回落未分组（验收 4：不删资产）', () => {
    const assets = [makeAsset('1', 'bank_deposit', 100_00, 'g1')];
    const sections = groupAssets(assets, removeGroup(groups, 'g1'));
    expect(sections.map((s) => s.key)).toEqual(['ungrouped', 'g2']);
    expect(sections[0]!.data.map((a) => a.id)).toEqual(['1']);
  });

  it('指向不存在分组的资产落入未分组', () => {
    const assets = [makeAsset('1', 'cash', 100, 'ghost')];
    const sections = groupAssets(assets, groups);
    expect(sections[0]!.data).toHaveLength(1);
  });

  it('空分组保留展示，小计为 0', () => {
    const sections = groupAssets([], groups);
    expect(sections).toHaveLength(3);
    expect(sections[1]!.assetTotal).toBe(0);
    expect(sections[1]!.data).toEqual([]);
  });

  it('组内按金额绝对值倒序', () => {
    const assets = [
      makeAsset('1', 'cash', 100, 'g1'),
      makeAsset('2', 'cash', 500, 'g1'),
      makeAsset('3', 'debt', -900, 'g1'),
    ];
    const s = groupAssets(assets, groups).find((x) => x.key === 'g1')!;
    expect(s.data.map((a) => a.id)).toEqual(['3', '2', '1']);
  });
});

describe('toggleCollapsed', () => {
  it('切换折叠状态且不改动其他 key', () => {
    const c = toggleCollapsed({ g1: true }, 'g1');
    expect(c['g1']).toBe(false);
    const c2 = toggleCollapsed({ g1: true }, 'ungrouped');
    expect(c2).toEqual({ g1: true, ungrouped: true });
  });
});
