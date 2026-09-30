/**
 * 资产分组（P0-4）—— 纯逻辑层
 *
 * 口径（与用户对齐，验收 2 选择「明确为本机配置」）：
 * - 分组元数据（名称/排序）与折叠状态只存本机 AsyncStorage，不跨设备同步；
 * - 资产归属（details.groupId）随资产 E2E 加密同步——换机后归属关系仍在，
 *   新设备上没有同名分组时自动落到「未分组」，不产生错误展示。
 *
 * 小计口径：与列表页类型分组一致——债务不计入资产合计，单独给负债合计
 * （取绝对值，UI 加负号标红）。
 */

import type { Asset } from '@family-wealth/shared-types';

export interface AssetGroup {
  id: string;
  name: string;
  /** 排序权重，越小越靠前；新分组追加到末尾 */
  order: number;
  createdAt: string;
}

/** details 里归属字段的 key */
export const GROUP_ID_KEY = 'groupId';

/** 读取资产归属分组 id；未分组 / 脏数据返回 null */
export function getAssetGroupId(asset: Asset): string | null {
  const raw = asset.details?.[GROUP_ID_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** 生成写回 details 的补丁：groupId 为 null 时移除该 key（回未分组） */
export function withGroupId(
  details: Record<string, unknown>,
  groupId: string | null,
): Record<string, unknown> {
  const next = { ...details };
  if (groupId === null) {
    delete next[GROUP_ID_KEY];
  } else {
    next[GROUP_ID_KEY] = groupId;
  }
  return next;
}

// ---------- 分组 CRUD（全部返回新数组，不原地改） ----------

/** 按 order 升序；同 order 按创建时间升序兜底，保证渲染稳定 */
export function sortGroups(groups: readonly AssetGroup[]): AssetGroup[] {
  return [...groups].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.createdAt < b.createdAt ? -1 : 1,
  );
}

export function createGroup(
  groups: readonly AssetGroup[],
  id: string,
  name: string,
  now: string = new Date().toISOString(),
): AssetGroup[] {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('分组名称不能为空');
  if (groups.some((g) => g.name === trimmed)) throw new Error('已存在同名分组');
  const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), -1);
  return sortGroups([...groups, { id, name: trimmed, order: maxOrder + 1, createdAt: now }]);
}

export function renameGroup(
  groups: readonly AssetGroup[],
  id: string,
  name: string,
): AssetGroup[] {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('分组名称不能为空');
  if (groups.some((g) => g.id !== id && g.name === trimmed)) {
    throw new Error('已存在同名分组');
  }
  if (!groups.some((g) => g.id === id)) throw new Error('分组不存在');
  return sortGroups(groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
}

/** 删除分组：只删配置，资产侧由 groupAssets 自动回落「未分组」（验收 4） */
export function removeGroup(groups: readonly AssetGroup[], id: string): AssetGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** 上移/下移一位（在排序后的视图内交换 order） */
export function moveGroup(
  groups: readonly AssetGroup[],
  id: string,
  direction: 'up' | 'down',
): AssetGroup[] {
  const sorted = sortGroups(groups);
  const idx = sorted.findIndex((g) => g.id === id);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  const a = idx >= 0 ? sorted[idx] : undefined;
  const b = target >= 0 && target < sorted.length ? sorted[target] : undefined;
  if (!a || !b) return sorted;
  return sortGroups(
    sorted.map((g) => {
      if (g.id === a.id) return { ...g, order: b.order };
      if (g.id === b.id) return { ...g, order: a.order };
      return g;
    }),
  );
}

// ---------- 分组视图聚合 ----------

export interface GroupSection {
  /** 'ungrouped' 表示未分组桶；其余为分组 id */
  key: string;
  /** 展示名；ungrouped 为「未分组」 */
  name: string;
  /** 组内资产合计（分，不含债务） */
  assetTotal: number;
  /** 组内负债合计（分，绝对值） */
  debtTotal: number;
  data: Asset[];
}

/**
 * 把资产聚成「分组视图」的 sections：
 * - 顺序 = sortGroups 后的分组顺序，未分组恒在最前；
 * - 指向已删除/不存在分组的资产自动落入未分组；
 * - 空分组保留展示（管理页可删），data 为空、小计为 0；
 * - 组内按金额绝对值倒序（与类型分组视图一致）。
 */
export function groupAssets(
  assets: readonly Asset[],
  groups: readonly AssetGroup[],
): GroupSection[] {
  const known = new Map(sortGroups(groups).map((g) => [g.id, g]));
  const buckets = new Map<string, Asset[]>();
  const ungrouped: Asset[] = [];

  for (const a of assets) {
    const gid = getAssetGroupId(a);
    if (gid !== null && known.has(gid)) {
      const list = buckets.get(gid) ?? [];
      list.push(a);
      buckets.set(gid, list);
    } else {
      ungrouped.push(a);
    }
  }

  const toSection = (key: string, name: string, list: Asset[]): GroupSection => {
    let assetTotal = 0;
    let debtTotal = 0;
    for (const a of list) {
      if (a.type === 'debt') debtTotal += Math.abs(a.currentAmount);
      else assetTotal += a.currentAmount;
    }
    return {
      key,
      name,
      assetTotal,
      debtTotal,
      data: [...list].sort((x, y) => Math.abs(y.currentAmount) - Math.abs(x.currentAmount)),
    };
  };

  const sections: GroupSection[] = [toSection('ungrouped', '未分组', ungrouped)];
  for (const g of known.values()) {
    sections.push(toSection(g.id, g.name, buckets.get(g.id) ?? []));
  }
  return sections;
}

/** 折叠状态持久化形状：section key（分组 id 或 'ungrouped'）→ 是否折叠 */
export type CollapsedMap = Record<string, boolean>;

export function toggleCollapsed(collapsed: CollapsedMap, key: string): CollapsedMap {
  return { ...collapsed, [key]: !collapsed[key] };
}
