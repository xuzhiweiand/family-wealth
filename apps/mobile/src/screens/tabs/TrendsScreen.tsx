/**
 * 趋势全屏
 *
 * - 日 / 周 / 月 / 年 四档：buildTrendSeries 先取每日序列，再按
 *   ISO 周 / 自然月 / 自然年归并（每桶取桶内最后一点，carry-forward）
 * - 顶部两张卡：当前净资产（区间变化）/ 历史峰值
 * - 三线图：净资产 / 总资产 / 总债务 + 图例
 * - 分类对比：按类别合计横向条形
 *
 * 全部本机计算，服务端只见密文（ADR-0006）。
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { buildTrendSeries } from '@family-wealth/analytics';
import { formatCNY, formatCNYCompact, pctChange } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { TrendPoint } from '@family-wealth/shared-types';
import { useAuthStore } from '../../stores/auth-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore } from '../../stores/family-store';
import { TrendChart, TREND_LINE_COLORS, type TrendLineKey } from '../../components/TrendChart';
import { OfflineBanner } from '../../components/OfflineBanner';
import {
  buildCategorySlices, findPeak, latestSnapshotAmountMap,
} from '../../lib/asset-meta';

type RangeKey = 'D' | 'W' | 'M' | 'Y';

const METRIC_LABELS: Record<TrendLineKey, string> = {
  netWorth: '净资产',
  totalAssets: '总资产',
  totalLiabilities: '总负债',
};

const RANGE_PRESETS: Record<RangeKey, { label: string; days: number; bucket: 'day' | 'week' | 'month' | 'year' }> = {
  D: { label: '日', days: 30, bucket: 'day' },
  W: { label: '周', days: 90, bucket: 'week' },
  M: { label: '月', days: 365, bucket: 'month' },
  Y: { label: '年', days: 365 * 5, bucket: 'year' },
};

function fromDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** ISO 周桶 key：YYYY-Www */
function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bucketKey(dateStr: string, bucket: 'day' | 'week' | 'month' | 'year'): string {
  if (bucket === 'day') return dateStr;
  if (bucket === 'week') return isoWeekKey(dateStr);
  if (bucket === 'month') return dateStr.slice(0, 7);
  return dateStr.slice(0, 4);
}

/**
 * 每日序列 → 分桶序列（每桶取最后一点，Map 插入顺序保持时间先后）。
 * 非日桶把 date 规范为桶 key（月 'YYYY-MM' / 周 'YYYY-Www' / 年 'YYYY'），
 * 让横坐标只显示对应粒度的短标签（月视图只显示月份），避免长日期重叠。
 */
function bucketize(series: readonly TrendPoint[], bucket: 'day' | 'week' | 'month' | 'year'): TrendPoint[] {
  if (bucket === 'day') return [...series];
  const map = new Map<string, TrendPoint>();
  for (const p of series) map.set(bucketKey(p.date, bucket), p);
  return [...map.entries()].map(([key, p]) => ({ ...p, date: key }));
}

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeKey>('M');
  // 三线指标切换：点 chip 显示/隐藏对应曲线（默认只展示净资产主线，
  // 总资产 / 总负债由用户点选后再叠加显示）
  const [metrics, setMetrics] = useState<Record<TrendLineKey, boolean>>({
    netWorth: true,
    totalAssets: false,
    totalLiabilities: false,
  });
  const activeLines = useMemo(
    () => (Object.keys(METRIC_LABELS) as TrendLineKey[]).filter((k) => metrics[k]),
    [metrics],
  );

  const user = useAuthStore((s) => s.user);
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);
  const sharedFamily = useFamilyStore((s) => s.family);
  const familyId = sharedFamily?.id ?? 'demo-family';

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

  const preset = RANGE_PRESETS[range];

  // 取整窗口每日序列再分桶
  const series = useMemo(() => {
    const daily = buildTrendSeries(snapshots, visibleAssets, {
      from: fromDaysAgo(preset.days),
      familyId,
    });
    return bucketize(daily, preset.bucket);
  }, [snapshots, visibleAssets, preset.days, preset.bucket, familyId]);

  const latest = series[series.length - 1];
  const first = series[0];
  const periodDelta = latest && first ? latest.netWorth - first.netWorth : 0;
  const periodPct = latest && first ? pctChange(latest.netWorth, first.netWorth) : 0;
  const periodUp = periodDelta >= 0;

  const peak = useMemo(() => findPeak(series), [series]);

  // 分类对比：用最新快照金额替代 currentAmount（快照口径 = 最新录入日期的数据）
  const cat = useMemo(() => {
    const amountMap = latestSnapshotAmountMap(snapshots);
    const assetsWithSnapshot = visibleAssets.map((a) => {
      const snapAmount = amountMap.get(a.id);
      return snapAmount !== undefined ? { ...a, currentAmount: snapAmount } : a;
    });
    return buildCategorySlices(assetsWithSnapshot);
  }, [visibleAssets, snapshots]);
  const maxCatAmount = cat.slices[0]?.amount ?? 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={{ height: insets.top, backgroundColor: '#F9FAFB' }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 标题 + 区间切换 */}
        <XStack justifyContent="space-between" alignItems="center" marginBottom="$md">
          <Text fontSize="$6" fontWeight="700" color="$textPrimary">资产趋势</Text>
          <View style={styles.segment}>
            {(Object.keys(RANGE_PRESETS) as RangeKey[]).map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setRange(k)}
                style={[styles.segmentItem, range === k ? styles.segmentActive : null]}
              >
                <Text fontSize="$2" fontWeight={range === k ? '700' : '500'}
                  color={range === k ? 'white' : '$textSecondary'}>
                  {RANGE_PRESETS[k].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </XStack>

        {/* 两张摘要卡 */}
        <XStack space="$sm">
          <YStack flex={1} padding="$md" backgroundColor="white" borderRadius="$lg"
            borderColor="$border" borderWidth={1}>
            <Text fontSize="$1" color="$textTertiary">当前净资产</Text>
            <Text fontSize="$5" fontWeight="700" color="$textPrimary" marginTop="$xs">
              {formatCNYCompact(latest?.netWorth ?? 0)}
            </Text>
            <Text fontSize="$1" fontWeight="600" marginTop="$xs"
              color={periodUp ? '#DC2626' : '#16A34A'}>
              {periodUp ? '▲' : '▼'} {Math.abs(periodPct).toFixed(2)}% 区间
            </Text>
          </YStack>
          <YStack flex={1} padding="$md" backgroundColor="white" borderRadius="$lg"
            borderColor="$border" borderWidth={1}>
            <Text fontSize="$1" color="$textTertiary">历史峰值</Text>
            <Text fontSize="$5" fontWeight="700" color="$textPrimary" marginTop="$xs">
              {formatCNYCompact(peak?.amount ?? 0)}
            </Text>
            <Text fontSize="$1" color="$textTertiary" marginTop="$xs">
              {peak ? peak.date : '—'}
            </Text>
          </YStack>
        </XStack>

        {/* 三线图 + 指标切换 */}
        <YStack padding="$md" backgroundColor="white" borderRadius="$lg"
          borderColor="$border" borderWidth={1} marginTop="$md">
          <XStack space="$sm" marginBottom="$sm" flexWrap="wrap">
            {(Object.keys(METRIC_LABELS) as TrendLineKey[]).map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setMetrics((m) => ({ ...m, [k]: !m[k] }))}
                style={[styles.metricChip, metrics[k]
                  ? { backgroundColor: TREND_LINE_COLORS[k], borderColor: TREND_LINE_COLORS[k] }
                  : null]}
              >
                <Text fontSize="$1" fontWeight={metrics[k] ? '700' : '500'}
                  color={metrics[k] ? 'white' : '$textSecondary'}>
                  {METRIC_LABELS[k]}
                </Text>
              </TouchableOpacity>
            ))}
          </XStack>
          {loading && series.length === 0 ? null : (
            <TrendChart
              data={series}
              height={220}
              lines={activeLines}
            />
          )}
        </YStack>

        {/* 分类对比 */}
        <Text fontSize="$4" fontWeight="700" color="$textPrimary" marginTop="$lg" marginBottom="$sm">
          分类对比
        </Text>
        <YStack padding="$md" backgroundColor="white" borderRadius="$lg"
          borderColor="$border" borderWidth={1} space="$sm">
          {cat.slices.length === 0 ? (
            <Text fontSize="$2" color="$textTertiary">暂无资产数据</Text>
          ) : (
            cat.slices.map((s) => (
              <YStack key={s.type} space="$xs">
                <XStack justifyContent="space-between">
                  <Text fontSize="$2" color="$textSecondary">{s.label}</Text>
                  <Text fontSize="$2" fontWeight="600" color="$textPrimary">
                    {formatCNYCompact(s.amount)}
                  </Text>
                </XStack>
                <View style={styles.barTrack}>
                  <View style={{
                    width: `${Math.max(2, (s.amount / maxCatAmount) * 100)}%`,
                    height: '100%', borderRadius: 999, backgroundColor: s.color,
                  }} />
                </View>
              </YStack>
            ))
          )}
          {cat.debtAmount > 0 ? (
            <YStack space="$xs">
              <XStack justifyContent="space-between">
                <Text fontSize="$2" color="$textSecondary">债务</Text>
                <Text fontSize="$2" fontWeight="600" color="#DC2626">
                  {formatCNYCompact(cat.debtAmount)}
                </Text>
              </XStack>
              <View style={styles.barTrack}>
                <View style={{
                  width: `${Math.max(2, (cat.debtAmount / maxCatAmount) * 100)}%`,
                  height: '100%', borderRadius: 999, backgroundColor: '#EF4444',
                }} />
              </View>
            </YStack>
          ) : null}
        </YStack>
      </ScrollView>
    </View>
  );
}

const styles = {
  segment: {
    flexDirection: 'row', backgroundColor: '#F3F4F6',
    borderRadius: 10, padding: 3,
  },
  segmentItem: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
  },
  segmentActive: { backgroundColor: '#10B981' },
  metricChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'white', borderColor: '#E5E7EB', borderWidth: 1,
  },
  barTrack: {
    height: 8, borderRadius: 999, backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
} as const;
