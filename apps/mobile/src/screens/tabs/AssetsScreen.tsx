/**
 * 资产列表
 *
 * 两种视图（P0-4 起）：
 * - 按类型：SectionList 按资产类型分组，组头显示类别名 / 数量 / 组合计，
 *   债务整组排最后、金额加负号标红；
 * - 按分组：按用户自定义分组（分组管理页维护，本机配置），组头显示
 *   分组名 / 数量 / 资产小计 + 负债小计，点组头折叠/展开。
 *
 * 顶部搜索（按名称）+ 类别 chips（含每类数量，仅类型视图）。
 * 点击进入资产详情；右上图标进回收站。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  SectionList, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAppNavigation } from '../../lib/navigation';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { formatCNY } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { Asset, AssetType } from '@family-wealth/shared-types';
import { useAuthStore } from '../../stores/auth-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore } from '../../stores/family-store';
import { OfflineBanner } from '../../components/OfflineBanner';
import { ASSET_TYPE_COLORS, ASSET_TYPE_LABELS, latestCapturedDateMap } from '../../lib/asset-meta';
import { groupAssets } from '../../lib/asset-groups';
import { useAssetGroupStore } from '../../stores/asset-group-store';

type ChipKey = AssetType | 'all';
type ViewMode = 'type' | 'group';

interface AssetSection {
  /** 类型视图为 AssetType；分组视图为分组 id / 'ungrouped' */
  key: string;
  type: AssetType | null;
  name: string;
  total: number;
  debtTotal: number;
  /** 折叠前的条数（分组视图折叠后 data 为空，仍要显示数量） */
  count: number;
  data: Asset[];
}

/** 债务展示口径：加负号、标红；其余正常显示 */
function displayAmount(asset: Asset): { text: string; color: string } {
  if (asset.type === 'debt') {
    return { text: `-${formatCNY(Math.abs(asset.currentAmount))}`, color: '#DC2626' };
  }
  return { text: formatCNY(asset.currentAmount), color: '#111827' };
}

export default function AssetsScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);
  const sharedFamily = useFamilyStore((s) => s.family);
  const familyId = sharedFamily?.id ?? 'demo-family';

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<ChipKey>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('type');

  const groups = useAssetGroupStore((s) => s.groups);
  const collapsed = useAssetGroupStore((s) => s.collapsed);
  const groupsHydrated = useAssetGroupStore((s) => s.hydrated);
  const hydrateGroups = useAssetGroupStore((s) => s.hydrate);
  const toggleCollapsed = useAssetGroupStore((s) => s.toggle);

  useEffect(() => {
    if (!groupsHydrated) void hydrateGroups();
  }, [groupsHydrated, hydrateGroups]);

  useEffect(() => {
    void load(familyId);
  }, [familyId, load]);

  const visibleAssets = useMemo(
    () =>
      filterVisibleAssets(
        assets.filter((a) => a.deletedAt === null),
        user?.id ?? '',
        useFamilyStore.getState().members.find((m) => m.userId === user?.id)?.role ?? 'viewer',
      ),
    [assets, user?.id],
  );

  // 每类数量（chips 用，不受搜索影响）
  const counts = useMemo(() => {
    const map = new Map<AssetType, number>();
    for (const a of visibleAssets) map.set(a.type, (map.get(a.type) ?? 0) + 1);
    return map;
  }, [visibleAssets]);

  const presentTypes = useMemo(
    () =>
      (Object.keys(ASSET_TYPE_LABELS) as AssetType[]).filter((t) => counts.has(t)),
    [counts],
  );

  // 列表时间字段展示「录入日期」（最新快照的记账日期），不再显示更新时间
  const capturedDates = useMemo(() => latestCapturedDateMap(snapshots), [snapshots]);

  // 过滤后的分组 sections（两种视图共用同一 SectionList）
  const sections = useMemo<AssetSection[]>(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (a: Asset) => q.length === 0 || a.name.toLowerCase().includes(q);

    if (viewMode === 'group') {
      return groupAssets(visibleAssets.filter(matchesQuery), groups).map((s) => ({
        key: s.key,
        type: null,
        name: s.name,
        total: s.assetTotal,
        debtTotal: s.debtTotal,
        count: s.data.length,
        data: collapsed[s.key] ? [] : s.data,
      }));
    }

    const map = new Map<AssetType, Asset[]>();
    for (const a of visibleAssets) {
      if (chip !== 'all' && a.type !== chip) continue;
      if (!matchesQuery(a)) continue;
      const list = map.get(a.type) ?? [];
      list.push(a);
      map.set(a.type, list);
    }
    const result: AssetSection[] = [...map.entries()].map(([type, list]) => {
      let total = 0;
      let debtTotal = 0;
      for (const a of list) {
        if (a.type === 'debt') debtTotal += Math.abs(a.currentAmount);
        else total += a.currentAmount;
      }
      return {
        key: type,
        type,
        name: ASSET_TYPE_LABELS[type],
        total,
        debtTotal,
        count: list.length,
        data: list.sort((x, y) => y.currentAmount - x.currentAmount),
      };
    });
    // 非债务组按合计倒序，债务组沉底
    return result.sort((x, y) => {
      if (x.type === 'debt') return 1;
      if (y.type === 'debt') return -1;
      return y.total - x.total;
    });
  }, [visibleAssets, query, chip, viewMode, groups, collapsed]);

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={{ height: insets.top, backgroundColor: '#F9FAFB' }} />
      <OfflineBanner />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <YStack space="$md" marginBottom="$md">
            <XStack justifyContent="space-between" alignItems="center">
              <YStack>
                <Text fontSize="$6" fontWeight="700" color="$textPrimary">我的资产</Text>
                <Text fontSize="$2" color="$textTertiary">
                  共 {visibleAssets.length} 项 · {viewMode === 'type' ? '按类型分组' : '按自定义分组'}
                </Text>
              </YStack>
              <TouchableOpacity
                onPress={() => navigation.navigate('AssetTrash')}
                style={styles.trashBtn}
                hitSlop={8}
              >
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
                  stroke="#6B7280" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M3 6h18" />
                  <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <Path d="M10 11v6M14 11v6" />
                </Svg>
              </TouchableOpacity>
            </XStack>

            {/* 视图切换：类型 / 分组 */}
            <XStack space="$xs" alignItems="center">
              <XStack backgroundColor="white" borderColor="$border" borderWidth={1}
                borderRadius={999} padding={3} gap={3}>
                <TouchableOpacity
                  style={[styles.modeTab, viewMode === 'type' && styles.modeTabActive]}
                  onPress={() => setViewMode('type')}
                >
                  <Text fontSize="$1" fontWeight={viewMode === 'type' ? '700' : '500'}
                    color={viewMode === 'type' ? 'white' : '$textSecondary'}>
                    按类型
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeTab, viewMode === 'group' && styles.modeTabActive]}
                  onPress={() => setViewMode('group')}
                >
                  <Text fontSize="$1" fontWeight={viewMode === 'group' ? '700' : '500'}
                    color={viewMode === 'group' ? 'white' : '$textSecondary'}>
                    按分组
                  </Text>
                </TouchableOpacity>
              </XStack>
              {viewMode === 'group' ? (
                <TouchableOpacity onPress={() => navigation.navigate('AssetGroups')} hitSlop={8}>
                  <Text fontSize="$1" color="$primary" fontWeight="600">管理分组</Text>
                </TouchableOpacity>
              ) : null}
            </XStack>

            {/* 搜索框 */}
            <View style={styles.searchWrap}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
                stroke="#9CA3AF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <CirclePath />
                <Path d="m21 21-4.3-4.3" />
              </Svg>
              <TextInput
                style={styles.searchInput}
                placeholder="搜索资产名称"
                placeholderTextColor="#9CA3AF"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <Text fontSize="$2" color="$textTertiary">清除</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* 类别 chips（类型视图） */}
            {viewMode === 'type' ? (
              <XStack flexWrap="wrap" gap={8}>
                <Chip
                  active={chip === 'all'}
                  label={`全部 ${visibleAssets.length}`}
                  onPress={() => setChip('all')}
                />
                {presentTypes.map((t) => (
                  <Chip
                    key={t}
                    active={chip === t}
                    label={`${ASSET_TYPE_LABELS[t]} ${counts.get(t)}`}
                    color={ASSET_TYPE_COLORS[t]}
                    onPress={() => setChip(t)}
                  />
                ))}
              </XStack>
            ) : null}
          </YStack>
        }
        renderSectionHeader={({ section }) => {
          const isDebtSection = section.type === 'debt';
          const header = (
            <XStack justifyContent="space-between" alignItems="center"
              marginTop="$md" marginBottom="$sm">
              <XStack space="$xs" alignItems="center">
                {viewMode === 'group' ? (
                  <Text fontSize="$2" color="$textTertiary">
                    {collapsed[section.key] ? '▸' : '▾'}
                  </Text>
                ) : (
                  <View style={{ width: 10, height: 10, borderRadius: 5,
                    backgroundColor: ASSET_TYPE_COLORS[section.type as AssetType] }} />
                )}
                <Text fontSize="$3" fontWeight="700" color="$textPrimary">
                  {section.name}
                </Text>
                <Text fontSize="$2" color="$textTertiary">· {section.count}</Text>
              </XStack>
              <XStack space="$sm" alignItems="center">
                {viewMode === 'type' ? (
                  <Text fontSize="$2" fontWeight="600"
                    color={isDebtSection ? '#DC2626' : '$textSecondary'}>
                    {isDebtSection ? '-' : ''}{formatCNY(section.total)}
                  </Text>
                ) : (
                  <>
                    <Text fontSize="$2" fontWeight="600" color="$textSecondary">
                      {formatCNY(section.total)}
                    </Text>
                    {section.debtTotal > 0 ? (
                      <Text fontSize="$2" fontWeight="600" color="#DC2626">
                        负债 -{formatCNY(section.debtTotal)}
                      </Text>
                    ) : null}
                  </>
                )}
              </XStack>
            </XStack>
          );
          if (viewMode === 'group') {
            return (
              <TouchableOpacity activeOpacity={0.7} onPress={() => toggleCollapsed(section.key)}>
                {header}
              </TouchableOpacity>
            );
          }
          return header;
        }}
        renderItem={({ item }) => {
          const d = displayAmount(item);
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => navigation.navigate('AssetDetail', { id: item.id })}
            >
              <XStack padding="$md" marginBottom="$sm" backgroundColor="white" borderRadius="$lg"
                borderColor="$border" borderWidth={1} alignItems="center" space="$md">
                <View style={{ width: 10, height: 10, borderRadius: 5,
                  backgroundColor: ASSET_TYPE_COLORS[item.type] }} />
                <YStack flex={1}>
                  <XStack space="$xs" alignItems="center">
                    <Text fontSize="$3" fontWeight="600" color="$textPrimary">{item.name}</Text>
                    {item.visibility === 'private' ? (
                      <View style={styles.privateTag}>
                        <Text fontSize={10} color="#6B7280">私密</Text>
                      </View>
                    ) : null}
                  </XStack>
                  <Text fontSize="$1" color="$textTertiary">
                    {capturedDates.get(item.id) ?? item.createdAt.slice(0, 10)} 录入
                  </Text>
                </YStack>
                <Text fontSize="$3" fontWeight="600" color={d.color}>{d.text}</Text>
              </XStack>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <YStack padding="$lg" alignItems="center">
            <Text fontSize="$2" color="$textTertiary">
              {loading ? '加载中…' : query || chip !== 'all'
                ? '没有符合条件的资产'
                : '还没有资产，点下方 + 录入第一笔'}
            </Text>
          </YStack>
        }
      />
    </View>
  );
}

function CirclePath() {
  return <Path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z" />;
}

function Chip({
  active, label, color, onPress,
}: {
  active: boolean;
  label: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active
        ? { backgroundColor: '#10B981', borderColor: '#10B981' }
        : null]}
    >
      {color && !active ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      ) : null}
      <Text fontSize="$1" fontWeight={active ? '700' : '500'}
        color={active ? 'white' : '$textSecondary'}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = {
  trashBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'white',
    borderColor: '#E5E7EB', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', borderRadius: 14,
    borderColor: '#E5E7EB', borderWidth: 1,
    paddingHorizontal: 14, height: 48,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: '#111827' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, backgroundColor: 'white',
    borderColor: '#E5E7EB', borderWidth: 1,
  },
  privateTag: {
    backgroundColor: '#F3F4F6', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  modeTab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
  },
  modeTabActive: {
    backgroundColor: '#10B981',
  },
} as const;
