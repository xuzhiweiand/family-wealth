/**
 * 资产列表
 *
 * - 顶部搜索（按名称）+ 类别 chips（含每类数量）
 * - 按资产类型分组（SectionList），组头显示类别名 / 数量 / 组合计
 * - 债务整组排最后、金额加负号标红
 * - 点击进入资产详情；右上图标进回收站
 */

import { useEffect, useMemo, useState } from 'react';
import {
  SectionList, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { formatCNY } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { Asset, AssetType } from '@family-wealth/shared-types';
import { useAuthStore } from '../../src/stores/auth-store';
import { useAssetStore } from '../../src/stores/asset-store';
import { useFamilyStore } from '../../src/stores/family-store';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { ASSET_TYPE_COLORS, ASSET_TYPE_LABELS, latestCapturedDateMap } from '../../src/lib/asset-meta';

type ChipKey = AssetType | 'all';

interface AssetSection {
  type: AssetType;
  total: number;
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
  const router = useRouter();
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

  // 过滤后的分组
  const sections = useMemo<AssetSection[]>(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<AssetType, Asset[]>();
    for (const a of visibleAssets) {
      if (chip !== 'all' && a.type !== chip) continue;
      if (q.length > 0 && !a.name.toLowerCase().includes(q)) continue;
      const list = map.get(a.type) ?? [];
      list.push(a);
      map.set(a.type, list);
    }
    const result: AssetSection[] = [...map.entries()].map(([type, list]) => ({
      type,
      total: list.reduce(
        (sum, a) => sum + (a.type === 'debt' ? Math.abs(a.currentAmount) : a.currentAmount),
        0,
      ),
      data: list.sort((x, y) => y.currentAmount - x.currentAmount),
    }));
    // 非债务组按合计倒序，债务组沉底
    return result.sort((x, y) => {
      if (x.type === 'debt') return 1;
      if (y.type === 'debt') return -1;
      return y.total - x.total;
    });
  }, [visibleAssets, query, chip]);

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
                  共 {visibleAssets.length} 项 · 按类型分组
                </Text>
              </YStack>
              <TouchableOpacity
                onPress={() => router.push('/asset/trash')}
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

            {/* 类别 chips */}
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
          </YStack>
        }
        renderSectionHeader={({ section }) => (
          <XStack justifyContent="space-between" alignItems="center"
            marginTop="$md" marginBottom="$sm">
            <XStack space="$xs" alignItems="center">
              <View style={{ width: 10, height: 10, borderRadius: 5,
                backgroundColor: ASSET_TYPE_COLORS[section.type] }} />
              <Text fontSize="$3" fontWeight="700" color="$textPrimary">
                {ASSET_TYPE_LABELS[section.type]}
              </Text>
              <Text fontSize="$2" color="$textTertiary">· {section.data.length}</Text>
            </XStack>
            <Text fontSize="$2" fontWeight="600"
              color={section.type === 'debt' ? '#DC2626' : '$textSecondary'}>
              {section.type === 'debt' ? '-' : ''}{formatCNY(section.total)}
            </Text>
          </XStack>
        )}
        renderItem={({ item }) => {
          const d = displayAmount(item);
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push(`/asset/${item.id}`)}
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
} as const;
