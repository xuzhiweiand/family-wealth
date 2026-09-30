/**
 * 资产分组（P0-4）—— 本机配置 store
 *
 * 口径：分组元数据与折叠状态仅本机 AsyncStorage（用户确认「明确为本机配置」，
 * 验收 2 二选一）。资产归属走 asset.details.groupId，随资产 E2E 同步，
 * 由 asset-store.updateAssetMeta 写回——本 store 只管分组配置与折叠状态。
 *
 * 持久化全部 fire-and-forget：读失败回落空配置，写失败不影响交互。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  createGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  toggleCollapsed,
  sortGroups,
  type AssetGroup,
  type CollapsedMap,
} from '../lib/asset-groups';
import { uuid as newId } from '../lib/uuid';

const GROUPS_KEY = 'family-wealth.asset-groups.v1';
const COLLAPSED_KEY = 'family-wealth.asset-groups.collapsed.v1';

interface AssetGroupState {
  groups: AssetGroup[];
  collapsed: CollapsedMap;
  /** 首次 hydrate 完成前为 false，避免闪烁出「未分组」全量列表 */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  add: (name: string) => AssetGroup;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  move: (id: string, direction: 'up' | 'down') => void;
  toggle: (sectionKey: string) => void;
}

function persistGroups(groups: AssetGroup[]): void {
  AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups)).catch(() => undefined);
}

function persistCollapsed(collapsed: CollapsedMap): void {
  AsyncStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed)).catch(() => undefined);
}

export const useAssetGroupStore = create<AssetGroupState>((set, get) => ({
  groups: [],
  collapsed: {},
  hydrated: false,

  async hydrate() {
    let groups: AssetGroup[] = [];
    let collapsed: CollapsedMap = {};
    try {
      const raw = await AsyncStorage.getItem(GROUPS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AssetGroup[];
        if (Array.isArray(parsed)) {
          groups = parsed.filter(
            (g) => typeof g?.id === 'string' && typeof g?.name === 'string',
          );
        }
      }
      const rawCollapsed = await AsyncStorage.getItem(COLLAPSED_KEY);
      if (rawCollapsed) {
        const parsed = JSON.parse(rawCollapsed) as CollapsedMap;
        if (parsed && typeof parsed === 'object') collapsed = parsed;
      }
    } catch {
      // 损坏数据回落空配置
    }
    set({ groups: sortGroups(groups), collapsed, hydrated: true });
  },

  add(name) {
    const group: AssetGroup = {
      id: newId(),
      name: name.trim(),
      order: 0,
      createdAt: new Date().toISOString(),
    };
    const groups = createGroup(get().groups, group.id, name, group.createdAt);
    const created = groups.find((g) => g.id === group.id)!;
    set({ groups });
    persistGroups(groups);
    return created;
  },

  rename(id, name) {
    const groups = renameGroup(get().groups, id, name);
    set({ groups });
    persistGroups(groups);
  },

  remove(id) {
    const groups = removeGroup(get().groups, id);
    const collapsed = { ...get().collapsed };
    delete collapsed[id];
    set({ groups, collapsed });
    persistGroups(groups);
    persistCollapsed(collapsed);
  },

  move(id, direction) {
    const groups = moveGroup(get().groups, id, direction);
    set({ groups });
    persistGroups(groups);
  },

  toggle(sectionKey) {
    const collapsed = toggleCollapsed(get().collapsed, sectionKey);
    set({ collapsed });
    persistCollapsed(collapsed);
  },
}));
