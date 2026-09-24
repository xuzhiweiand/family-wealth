/**
 * 总览仪表盘
 *
 * 所有聚合都在本机完成（服务端只见密文，ADR-0006）：
 * 快照 → packages/analytics 聚合成趋势序列 → 本页计算净资产 / 本月变化 /
 * 资产分布 / 最近变化并渲染。视觉对齐高保真原型。
 */

import { useEffect, useMemo } from 'react';
import { ScrollView, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useAppNavigation } from '../../lib/navigation';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { buildTrendSeries } from '@family-wealth/analytics';
import { formatCNY, formatCNYCompact, pctChange } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { TrendPoint } from '@family-wealth/shared-types';
import { useAuthStore } from '../../stores/auth-store';
import { useKeyStore } from '../../stores/key-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore } from '../../stores/family-store';
import { TrendChart } from '../../components/TrendChart';
import { DonutChart } from '../../components/DonutChart';
import { GradientCard } from '../../components/GradientCard';
import { OfflineBanner } from '../../components/OfflineBanner';
import {
  buildCategorySlices,
  buildMonthTotals,
  buildRecentChanges,
} from '../../lib/asset-meta';

const TREND_WINDOW_DAYS = 365;
const PAGE_PAD = 20;

/** A 股习惯：涨红跌绿 */
const UP_COLOR = '#DC2626';
const DOWN_COLOR = '#16A34A';

function fromDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 每日序列 → 按月序列（每月取桶内最后一点）。
 * 日序列已做前向填充，窗口内每个月都会有值，所以得到连续 12 个月的轴。
 * date 规范为桶 key 'YYYY-MM'，横坐标只显示月份。
 */
function bucketizeMonth(series: readonly TrendPoint[]): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  for (const p of series) map.set(p.date.slice(0, 7), p);
  return [...map.entries()].map(([month, p]) => ({ ...p, date: month }));
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '凌晨好';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export default function HomeScreen() {
  const navigation = useAppNavigation();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - PAGE_PAD * 2;
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const umk = useKeyStore((s) => s.umk);
  const sharedFamily = useFamilyStore((s) => s.family);

  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);

  // 真实家庭 id；无 env / 无家庭时用 demo-family 兜底，保证 UI 可跑
  const familyId = sharedFamily?.id ?? 'demo-family';

  useEffect(() => {
    void load(familyId);
  }, [familyId, load]);

  // 可见口径：软删过滤 + 私有资产不计入家庭净资产
  const visibleAssets = useMemo(
    () =>
      filterVisibleAssets(
        assets.filter((a) => a.deletedAt === null),
        user?.id ?? '',
        useFamilyStore.getState().members.find((m) => m.userId === user?.id)?.role ?? 'viewer',
      ),
    [assets, user?.id],
  );

  // 近一年：先取每日三线序列（carry-forward），再按自然月归并
  const series = useMemo(() => {
    const daily = buildTrendSeries(snapshots, visibleAssets, {
      from: fromDaysAgo(TREND_WINDOW_DAYS),
      familyId,
    });
    return bucketizeMonth(daily);
  }, [snapshots, visibleAssets, familyId]);

  // 卡片三值：月度台账口径 —— 只统计当月有快照的资产（每笔取当月最新一条），
  // 往月的历史录入不再被加总进当月卡片
  const monthTotals = useMemo(
    () => buildMonthTotals(visibleAssets, snapshots),
    [visibleAssets, snapshots],
  );
  const lastMonthTotals = useMemo(() => {
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    return buildMonthTotals(visibleAssets, snapshots, prev);
  }, [visibleAssets, snapshots]);

  const netWorth = monthTotals.netWorth;

  // 本月变化：当月合计相对上月合计
  const monthStats = useMemo(
    () => ({
      delta: monthTotals.netWorth - lastMonthTotals.netWorth,
      pct: pctChange(monthTotals.netWorth, lastMonthTotals.netWorth),
    }),
    [monthTotals, lastMonthTotals],
  );

  const cat = useMemo(() => buildCategorySlices(visibleAssets), [visibleAssets]);
  const recent = useMemo(() => buildRecentChanges(visibleAssets, snapshots), [visibleAssets, snapshots]);

  const monthUp = monthStats.delta >= 0;
  const hasFamily = sharedFamily !== null;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={{ height: insets.top, backgroundColor: '#F9FAFB' }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: PAGE_PAD, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 顶部问候 */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom="$md">
          <YStack>
            <Text fontSize="$2" color="$textSecondary">{greeting()}，</Text>
            <Text fontSize="$5" fontWeight="700" color="$textPrimary">
              {hasFamily ? sharedFamily.name : user?.displayName ?? '我的家庭'}
            </Text>
          </YStack>
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center',
          }}>
            <Text fontSize="$4" fontWeight="700" color="white">
              {(user?.displayName ?? '我').slice(0, 1)}
            </Text>
          </View>
        </XStack>

        {/* 无家庭引导 */}
        {!hasFamily ? (
          <YStack space="$sm" marginBottom="$md" padding="$md"
            backgroundColor="#ECFDF5" borderRadius="$lg" borderColor="#A7F3D0" borderWidth={1}>
            <Text fontSize="$3" fontWeight="700" color="#065F46">先创建或加入一个家庭</Text>
            <Text fontSize="$2" color="#047857">家庭是数据隔离与共享的边界，之后即可录入资产。</Text>
            <XStack space="$sm" marginTop="$xs">
              <TouchableOpacity style={styles.pillPrimary} onPress={() => navigation.navigate('Family')}>
                <Text fontSize="$2" color="white" fontWeight="600">创建 / 加入家庭</Text>
              </TouchableOpacity>
            </XStack>
          </YStack>
        ) : null}

        {/* 渐变净资产卡 */}
        <GradientCard width={cardWidth} height={212} radius={24}>
          <YStack flex={1} padding="$lg" justifyContent="space-between">
            <Text fontSize="$2" color="white" opacity={0.9}>家庭净资产</Text>
            <View>
              <XStack alignItems="baseline">
                <Text fontSize="$3" color="white" opacity={0.9}>¥</Text>
                <Text fontSize={34} fontWeight="700" color="white" letterSpacing={-0.5}>
                  {(netWorth / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </Text>
              </XStack>
              <XStack space="$sm" alignItems="center" marginTop="$xs">
                <View style={styles.monthPill}>
                  <Text fontSize="$1" color="white" fontWeight="600">
                    {monthUp ? '▲' : '▼'} {Math.abs(monthStats.pct).toFixed(2)}% 本月
                  </Text>
                </View>
                <Text fontSize="$2" color="white" opacity={0.9}>
                  {monthUp ? '+' : ''}{formatCNYCompact(monthStats.delta)}
                </Text>
              </XStack>
            </View>
            <XStack space="$sm">
              <View style={styles.subBox}>
                <Text fontSize="$1" color="white" opacity={0.8}>总资产</Text>
                <Text fontSize="$3" color="white" fontWeight="600">
                  {formatCNYCompact(monthTotals.totalAssets)}
                </Text>
              </View>
              <View style={styles.subBox}>
                <Text fontSize="$1" color="white" opacity={0.8}>总负债</Text>
                <Text fontSize="$3" color="white" fontWeight="600">
                  {formatCNYCompact(monthTotals.totalLiabilities)}
                </Text>
              </View>
            </XStack>
          </YStack>
        </GradientCard>

        {/* 快捷操作 */}
        <XStack justifyContent="space-between" marginVertical="$lg">
          <QuickAction label="录入" bg="#D1FAE5" color="#059669"
            icon={<Path d="M12 5v14M5 12h14" />}
            onPress={() => navigation.navigate('AssetNew')} />
          <QuickAction label="趋势" bg="#EDE9FE" color="#7C3AED"
            icon={<><Path d="M3 3v18h18" /><Path d="M8 17v-5M13 17V8M18 17v-3" /></>}
            onPress={() => navigation.navigate('Trends')} />
          <QuickAction label="家庭" bg="#FEF3C7" color="#D97706"
            icon={<><Path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><CircleDef /><Path d="M21 21v-2a4 4 0 0 0-3-3.9" /><Path d="M16 3.1a4 4 0 0 1 0 7.8" /></>}
            onPress={() => navigation.navigate('Family')} />
        </XStack>

        {/* 近一年趋势（月粒度） */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom="$sm">
          <Text fontSize="$4" fontWeight="700" color="$textPrimary">近一年趋势</Text>
          <Text fontSize="$2" color="$primary" onPress={() => navigation.navigate('Trends')}>全屏 ›</Text>
        </XStack>
        <YStack padding="$sm" backgroundColor="white" borderRadius="$lg"
          borderColor="$border" borderWidth={1} marginBottom="$md">
          <TrendChart data={series} height={140} lines={['netWorth']} />
        </YStack>

        {/* 资产分布 */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom="$sm">
          <Text fontSize="$4" fontWeight="700" color="$textPrimary">资产分布</Text>
          <Text fontSize="$2" color="$primary" onPress={() => navigation.navigate('Trends')}>详情 ›</Text>
        </XStack>
        <YStack padding="$md" backgroundColor="white" borderRadius="$lg"
          borderColor="$border" borderWidth={1}>
          <XStack space="$md" alignItems="center">
            <DonutChart
              slices={cat.slices}
              centerTop={`${cat.slices.length} 类`}
              centerBottom="资产"
            />
            <YStack flex={1} space="$xs">
              {cat.slices.slice(0, 4).map((s) => (
                <XStack key={s.type} justifyContent="space-between">
                  <XStack space="$xs" alignItems="center">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                    <Text fontSize="$2" color="$textSecondary">{s.label}</Text>
                  </XStack>
                  <Text fontSize="$2" fontWeight="600" color="$textPrimary">{s.pct.toFixed(1)}%</Text>
                </XStack>
              ))}
              {cat.debtAmount > 0 ? (
                <XStack justifyContent="space-between">
                  <XStack space="$xs" alignItems="center">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }} />
                    <Text fontSize="$2" color="$textSecondary">债务</Text>
                  </XStack>
                  <Text fontSize="$2" fontWeight="600" color="#EF4444">-{cat.debtShare.toFixed(1)}%</Text>
                </XStack>
              ) : null}
            </YStack>
          </XStack>
        </YStack>

        {/* 最近变化 */}
        <XStack justifyContent="space-between" alignItems="center" marginTop="$lg" marginBottom="$sm">
          <Text fontSize="$4" fontWeight="700" color="$textPrimary">最近变化</Text>
          <Text fontSize="$1" color="$textTertiary">过去 7 天</Text>
        </XStack>
        {recent.length === 0 ? (
          <YStack padding="$md" backgroundColor="white" borderRadius="$lg"
            borderColor="$border" borderWidth={1}>
            <Text fontSize="$2" color="$textSecondary">
              {loading ? '加载中…' : '近 7 天暂无变化，更新资产金额后会出现在这里'}
            </Text>
          </YStack>
        ) : (
          recent.map((rc) => {
            const up = rc.delta >= 0;
            return (
              <TouchableOpacity key={rc.asset.id} activeOpacity={0.7}
                onPress={() => navigation.navigate('AssetDetail', { id: rc.asset.id })}>
                <XStack padding="$md" marginBottom="$sm" backgroundColor="white" borderRadius="$lg"
                  borderColor="$border" borderWidth={1} alignItems="center" space="$md">
                  <YStack flex={1}>
                    <Text fontSize="$3" fontWeight="600" color="$textPrimary">{rc.asset.name}</Text>
                    <Text fontSize="$1" color="$textTertiary">
                      {rc.at.slice(0, 10)} · {rc.source === 'ocr' ? '拍照识别' : '手动更新'}
                    </Text>
                  </YStack>
                  <YStack alignItems="flex-end">
                    <Text fontSize="$3" fontWeight="600" color="$textPrimary">
                      {formatCNY(rc.asset.currentAmount)}
                    </Text>
                    {rc.previousAmount !== null ? (
                      <Text fontSize="$1" color={up ? UP_COLOR : DOWN_COLOR} fontWeight="600">
                        {up ? '+' : ''}{formatCNYCompact(rc.delta)}
                      </Text>
                    ) : null}
                  </YStack>
                </XStack>
              </TouchableOpacity>
            );
          })
        )}

        <Text fontSize="$1" color="$textTertiary" marginTop="$md">
          UMK：{umk === null ? '未派生' : '已派生 ✓'} · 数据仅存本机，同步时以密文上行
        </Text>
      </ScrollView>
    </View>
  );
}

function CircleDef() {
  return <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />;
}

function QuickAction({
  label, bg, color, icon, onPress,
}: {
  label: string;
  bg: string;
  color: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={{ alignItems: 'center', width: 64 }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"
          stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </Svg>
      </View>
      <Text fontSize="$1" color="$textSecondary" marginTop="$xs">{label}</Text>
    </TouchableOpacity>
  );
}

const styles = {
  monthPill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  subBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 12,
  },
  pillPrimary: {
    backgroundColor: '#059669',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
} as const;
