/**
 * 首页（总览）
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-home.html」复刻：
 *   问候 → 家庭净资产 hero（含迷你走势 + 总资产/总负债/资产负债率三列）
 *   → 月度小结条 → 资产构成（按类型分组明细）→ 隐私说明。
 *
 * 所有聚合都在本机完成（服务端只见密文，ADR-0006）：
 * 快照 → packages/analytics 聚合成月度序列 → 本页计算净资产 / 本月变化 /
 * 资产负债率 / 资产分组。
 */

import { COLORS, GOLD_DECOR, GOLD_ON_INK } from '../../theme';
import { MONEY_TEXT, SERIF_CN_TEXT } from '../../typography';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import type { DimensionValue } from 'react-native';
import { useAppNavigation } from '../../lib/navigation';
import Svg, {
  Circle, Defs, LinearGradient, Path, Rect, Stop,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { buildTrendSeries } from '@family-wealth/analytics';
import { formatCNY, pctChange } from '@family-wealth/shared-utils';
import { filterVisibleAssets } from '@family-wealth/family';
import type { Asset, AssetType, TrendPoint } from '@family-wealth/shared-types';
import { useAuthStore } from '../../stores/auth-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore } from '../../stores/family-store';
import { GradientCard } from '../../components/GradientCard';
import { OfflineBanner } from '../../components/OfflineBanner';
import {
  ASSET_TYPE_LABELS,
  buildDisplayMonthTotals,
  buildMonthTotals,
  monthKeyOf,
} from '../../lib/asset-meta';

const TREND_WINDOW_DAYS = 365;
const PAGE_PAD = 20;
const HERO_HEIGHT = 264;

/** 资产构成分组展示顺序：现金 → 投资 → 不动产/实物 → 债权 → 负债 */
const GROUP_ORDER: AssetType[] = [
  'cash', 'bank_deposit', 'fund', 'stock', 'wealth_management',
  'precious_metal', 'crypto', 'real_estate', 'vehicle', 'receivable', 'debt',
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fromDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** 每日序列 → 按月序列（每月取桶内最后一点）。 */
function bucketizeMonth(series: readonly TrendPoint[]): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  for (const p of series) map.set(p.date.slice(0, 7), p);
  return [...map.entries()].map(([month, p]) => ({ ...p, date: month }));
}

/** 中文月份：'2026-10' → '十月' */
function monthCN(key: string): string {
  const m = Number(key.slice(5, 7));
  return ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'][m - 1] ?? key;
}

/** 金额（分）→ '3,356,200' */
function amountText(cents: number): string {
  return formatCNY(cents, { fraction: false }).replace('¥', '');
}

/** 资产副标题：优先取 details 里的描述字段，否则展示更新日期 */
function assetSubtitle(a: Asset): string {
  const d = a.details ?? {};
  for (const key of ['bankName', 'accountTail', 'term', 'rate', 'address', 'area', 'note', 'desc']) {
    const v = d[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  const date = a.updatedAt.slice(5, 10);
  return `更新于 ${date}`;
}

/** 迷你折线：把月度净资产序列映射到 300×44 视口 */
function sparkPaths(points: readonly TrendPoint[]): { line: string; area: string } {
  const values = points.map((p) => p.netWorth);
  if (values.length === 0) return { line: '', area: '' };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? 300 / (values.length - 1) : 0;
  const coords = values.map((v, i) => {
    const x = 2 + i * step;
    const y = 38 - ((v - min) / span) * 30;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${coords.join(' L')}`;
  const firstX = 2;
  const lastX = 2 + (values.length - 1) * step;
  const area = `${line} L${lastX.toFixed(1)},44 L${firstX.toFixed(1)},44 Z`;
  return { line, area };
}

function iconFor(type: AssetType): React.ReactNode {
  switch (type) {
    case 'cash':
    case 'bank_deposit':
      return (
        <>
          <Rect width={20} height={12} x={2} y={6} rx={2} />
          <Path d="M6 12h.01M18 12h.01" />
        </>
      );
    case 'fund':
    case 'stock':
    case 'wealth_management':
    case 'crypto':
      return (
        <>
          <Path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <Path d="m19 9-5 5-4-4-3 3" />
        </>
      );
    case 'precious_metal':
      return (
        <>
          <Circle cx={12} cy={12} r={8} />
          <Path d="M12 8v8M9.5 9.7h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4" />
        </>
      );
    case 'real_estate':
      return (
        <>
          <Path d="m3 11 9-8 9 8" />
          <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
        </>
      );
    case 'vehicle':
      return (
        <>
          <Path d="M5 17h14l-1.5-6.5a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5L5 17Z" />
          <Path d="M7 17v2M17 17v2" />
        </>
      );
    case 'receivable':
      return (
        <>
          <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </>
      );
    default:
      return (
        <>
          <Rect width={20} height={14} x={2} y={5} rx={2} />
          <Path d="M2 10h20" />
        </>
      );
  }
}

function chipTone(type: AssetType): { bg: string; color: string } {
  if (type === 'debt') return { bg: COLORS.dangerWash, color: COLORS.danger };
  if (['fund', 'stock', 'wealth_management', 'precious_metal', 'crypto'].includes(type)) {
    return { bg: COLORS.warningWash, color: COLORS.goldDeep };
  }
  return { bg: COLORS.inkWash, color: COLORS.ink };
}

export default function HomeScreen() {
  const navigation = useAppNavigation();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - PAGE_PAD * 2;
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const sharedFamily = useFamilyStore((s) => s.family);
  const familyRefreshed = useFamilyStore((s) => s.refreshed);

  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const loadedFamilyId = useAssetStore((s) => s.loadedFamilyId);
  const load = useAssetStore((s) => s.load);

  const familyId = sharedFamily?.id ?? 'demo-family';
  const [hideAmounts, setHideAmounts] = useState(false);

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

  // 近一年每日序列 → 月度序列
  const series = useMemo(() => {
    const daily = buildTrendSeries(snapshots, visibleAssets, {
      from: fromDaysAgo(TREND_WINDOW_DAYS),
      familyId,
    });
    return bucketizeMonth(daily);
  }, [snapshots, visibleAssets, familyId]);

  // 卡片三值：月度台账口径
  const displayTotals = useMemo(
    () => buildDisplayMonthTotals(visibleAssets, snapshots),
    [visibleAssets, snapshots],
  );
  const monthTotals = displayTotals;
  const lastMonthTotals = useMemo(() => {
    const [y, m] = displayTotals.month.split('-').map(Number) as [number, number];
    return buildMonthTotals(visibleAssets, snapshots, new Date(y, m - 2, 15));
  }, [visibleAssets, snapshots, displayTotals.month]);

  // 上一份已归档月报：上月相对上上月的变化
  const monthBeforeTotals = useMemo(() => {
    const [y, m] = displayTotals.month.split('-').map(Number) as [number, number];
    return buildMonthTotals(visibleAssets, snapshots, new Date(y, m - 3, 15));
  }, [visibleAssets, snapshots, displayTotals.month]);
  const archivedMonth = useMemo(() => {
    const [y, m] = displayTotals.month.split('-').map(Number) as [number, number];
    return monthKeyOf(new Date(y, m - 2, 15));
  }, [displayTotals.month]);
  const archivedDelta = lastMonthTotals.netWorth - monthBeforeTotals.netWorth;

  const netWorth = monthTotals.netWorth;
  const currentMonth = monthKeyOf(new Date());

  const monthStats = useMemo(
    () => ({
      delta: monthTotals.netWorth - lastMonthTotals.netWorth,
      pct: pctChange(monthTotals.netWorth, lastMonthTotals.netWorth),
    }),
    [monthTotals, lastMonthTotals],
  );

  const debtRatio = monthTotals.totalAssets > 0
    ? (monthTotals.totalLiabilities / monthTotals.totalAssets) * 100
    : 0;

  const spark = useMemo(() => series.slice(-6), [series]);
  const sparkPath = useMemo(() => sparkPaths(spark), [spark]);

  // 资产构成：按类型分组（负债排在最后）
  const groups = useMemo(() => {
    const byType = new Map<AssetType, Asset[]>();
    for (const a of visibleAssets) {
      const list = byType.get(a.type);
      if (list) list.push(a);
      else byType.set(a.type, [a]);
    }
    return GROUP_ORDER
      .filter((t) => byType.has(t))
      .map((type) => {
        const list = (byType.get(type) ?? []).slice().sort((a, b) => Math.abs(b.currentAmount) - Math.abs(a.currentAmount));
        const total = list.reduce((sum, a) => sum + (t3(type) ? -Math.abs(a.currentAmount) : a.currentAmount), 0);
        return { type, label: ASSET_TYPE_LABELS[type], list, total };
      });
  }, [visibleAssets]);

  const updatedAtText = useMemo(() => {
    let latest = '';
    for (const a of visibleAssets) if (a.updatedAt > latest) latest = a.updatedAt;
    if (latest === '') return '—';
    return latest.slice(5, 16).replace('T', ' ');
  }, [visibleAssets]);

  const hasFamily = sharedFamily !== null;
  const monthUp = monthStats.delta >= 0;

  if (!familyRefreshed || loadedFamilyId !== familyId) {
    return <HomeSkeleton width={cardWidth} topInset={insets.top} />;
  }

  const now = new Date();
  const dateLine = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}`;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <View style={{ height: insets.top, backgroundColor: COLORS.paper }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 顶部问候 */}
        <XStack paddingHorizontal={24} paddingTop={8} paddingBottom={16}
          alignItems="center" justifyContent="space-between">
          <YStack>
            <Text fontSize={11} color={COLORS.faint} letterSpacing={2}>{dateLine}</Text>
            <Text fontSize={21} color={COLORS.text} letterSpacing={0.8} marginTop={4} style={SERIF_CN_TEXT}>
              {hasFamily ? `${user?.displayName ?? '家人'}，见字如面` : '见字如面'}
            </Text>
          </YStack>
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: 'rgba(11,61,46,0.08)',
            borderWidth: 1, borderColor: 'rgba(11,61,46,0.14)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text fontSize={14} color={COLORS.ink} style={SERIF_CN_TEXT}>
              {(user?.displayName ?? '我').slice(0, 1)}
            </Text>
          </View>
        </XStack>

        {/* 无家庭引导（仅在未加入家庭时出现） */}
        {!hasFamily ? (
          <YStack marginHorizontal={PAGE_PAD} marginBottom={16} padding={16}
            backgroundColor={COLORS.surface} borderRadius={20}
            borderColor={COLORS.hairlineSoft} borderWidth={1} space={6}>
            <Text fontSize={13} fontWeight="600" color={COLORS.text}>先创建或加入一个家庭</Text>
            <Text fontSize={11} color={COLORS.sub}>家庭是数据隔离与共享的边界，之后即可录入资产。</Text>
            <TouchableOpacity style={styles.pillPrimary} onPress={() => navigation.navigate('Family')}>
              <Text fontSize={11} color={COLORS.surface} fontWeight="600">创建 / 加入家庭</Text>
            </TouchableOpacity>
          </YStack>
        ) : null}

        {/* 净资产 hero */}
        <View style={{ paddingHorizontal: PAGE_PAD }}>
          <GradientCard width={cardWidth} height={HERO_HEIGHT} radius={26}>
            <YStack flex={1} paddingHorizontal={24} paddingTop={24} paddingBottom={20}>
              <XStack alignItems="flex-start" justifyContent="space-between">
                <YStack>
                  <XStack alignItems="center" space={8}>
                    <Text fontSize={10.5} color="rgba(233,220,192,0.55)" letterSpacing={3}>
                      家庭净资产（元）
                    </Text>
                    {displayTotals.fallback ? (
                      <View style={styles.monthPill}>
                        <Text fontSize={9} color={COLORS.goldLight}>数据截至 {displayTotals.month}</Text>
                      </View>
                    ) : null}
                  </XStack>
                  <XStack alignItems="flex-end" space={8} marginTop={10}>
                    <Text fontSize={34} lineHeight={38} fontWeight="600" color="#F7F3E8" style={MONEY_TEXT}>
                      {hideAmounts ? '¥ · · · · · ·' : `¥ ${amountText(netWorth)}`}
                    </Text>
                    <TouchableOpacity onPress={() => setHideAmounts((v) => !v)} activeOpacity={0.7}
                      style={{ paddingBottom: 6 }} accessibilityLabel={hideAmounts ? '显示金额' : '隐藏金额'}>
                      <Svg width={19} height={19} viewBox="0 0 24 24" fill="none"
                        stroke="rgba(233,220,192,0.62)" strokeWidth={1.8}
                        strokeLinecap="round" strokeLinejoin="round">
                        {hideAmounts ? (
                          <>
                            <Path d="M9.9 4.24A9.5 9.5 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                            <Path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                            <Path d="m2 2 20 20M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          </>
                        ) : (
                          <>
                            <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                            <Circle cx={12} cy={12} r={3} />
                          </>
                        )}
                      </Svg>
                    </TouchableOpacity>
                  </XStack>
                </YStack>
              </XStack>

              {/* 本月变化 */}
              <XStack alignItems="center" space={8} marginTop={14}>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                  stroke={COLORS.gold} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="m22 7-8.5 8.5L8.5 10.5 2 17" />
                  <Path d="M16 7h6v6" />
                </Svg>
                <Text fontSize={12} color={COLORS.goldLight} style={MONEY_TEXT}>
                  本月 {monthUp ? '+' : '-'}{amountText(Math.abs(monthStats.delta))}
                </Text>
                <View style={styles.pctPill}>
                  <Text fontSize={10} color={COLORS.goldLight} style={MONEY_TEXT}>
                    {monthUp ? '+' : ''}{monthStats.pct.toFixed(2)}%
                  </Text>
                </View>
              </XStack>

              {/* 迷你走势 */}
              {sparkPath.line === '' ? null : (
                <Svg width="100%" height={44} viewBox="0 0 304 44" style={{ marginTop: 14 }}>
                  <Defs>
                    <LinearGradient id="homeSparkFill" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={COLORS.goldLight} stopOpacity={0.22} />
                      <Stop offset="1" stopColor={COLORS.goldLight} stopOpacity={0} />
                    </LinearGradient>
                  </Defs>
                  <Path d={sparkPath.area} fill="url(#homeSparkFill)" />
                  <Path d={sparkPath.line} fill="none" stroke={COLORS.gold} strokeWidth={1.6}
                    strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}

              <View style={styles.hairlineGold} />

              {/* 三列：总资产 / 总负债 / 资产负债率 */}
              <XStack marginTop={12}>
                <YStack flex={1} alignItems="center">
                  <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>总资产</Text>
                  <Text fontSize={15.5} color="#F2EEE2" marginTop={4} style={MONEY_TEXT}>
                    {hideAmounts ? '· · ·' : amountText(monthTotals.totalAssets)}
                  </Text>
                </YStack>
                <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                  <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>总负债</Text>
                  <Text fontSize={15.5} color="rgba(242,238,226,0.72)" marginTop={4} style={MONEY_TEXT}>
                    {hideAmounts ? '· · ·' : `-${amountText(monthTotals.totalLiabilities)}`}
                  </Text>
                </YStack>
                <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                  <Text fontSize={9.5} color="rgba(233,220,192,0.45)" letterSpacing={2}>资产负债率</Text>
                  <Text fontSize={15.5} color={COLORS.goldLight} marginTop={4} style={MONEY_TEXT}>
                    {debtRatio.toFixed(1)}%
                  </Text>
                </YStack>
              </XStack>
            </YStack>
          </GradientCard>
        </View>

        {/* 月度小结条 */}
        <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('Report')}
            style={styles.monthBar}>
            <View style={[styles.iconChip, { backgroundColor: COLORS.warningWash }]}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
                stroke={COLORS.goldDeep} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <Rect width={18} height={18} x={3} y={4} rx={2} />
                <Path d="M16 2v4M8 2v4M3 10h18" />
              </Svg>
            </View>
            <Text flex={1} fontSize={12} lineHeight={18} color={COLORS.sub}>
              {monthCN(archivedMonth)}报表已归档，结余{' '}
              <Text fontSize={12} fontWeight="600" color={archivedDelta >= 0 ? COLORS.ink : COLORS.danger} style={MONEY_TEXT}>
                {archivedDelta >= 0 ? '+' : '-'}{amountText(Math.abs(archivedDelta))}
              </Text>
            </Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
              stroke={COLORS.faint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m9 18 6-6-6-6" />
            </Svg>
          </TouchableOpacity>
        </View>

        {/* 资产构成 */}
        <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
          <XStack alignItems="baseline" justifyContent="space-between" marginBottom={8}>
            <Text fontSize={17} color={COLORS.text} letterSpacing={0.6} style={SERIF_CN_TEXT}>资产构成</Text>
            <Text fontSize={10.5} color={COLORS.faint}>更新于 {updatedAtText}</Text>
          </XStack>

          <View style={styles.card}>
            <View style={{ paddingHorizontal: 16 }}>
              {groups.length === 0 ? (
                <Text fontSize={12} color={COLORS.faint} paddingVertical={20}>
                  {loading ? '加载中…' : '还没有资产，去「更新」页录入第一笔'}
                </Text>
              ) : (
                groups.map((g) => (
                  <View key={g.type}>
                    <Text fontSize={10} color={COLORS.faint} letterSpacing={2} paddingTop={14}>
                      {g.label} · <Text fontSize={10} color={COLORS.faint} style={MONEY_TEXT}>
                        {hideAmounts ? '· · ·' : `${t3(g.type) ? '-' : ''}${amountText(Math.abs(g.total))}`}
                      </Text>
                    </Text>
                    {g.list.map((a, idx) => {
                      const tone = chipTone(g.type);
                      const debt = g.type === 'debt';
                      const isLast = idx === g.list.length - 1;
                      return (
                        <TouchableOpacity key={a.id} activeOpacity={0.65}
                          onPress={() => navigation.navigate('AssetDetail', { id: a.id })}>
                          <XStack alignItems="center" space={12} paddingVertical={13}
                            borderBottomWidth={isLast ? 0 : 1} borderBottomColor={COLORS.divider}>
                            <View style={[styles.iconChip, { backgroundColor: tone.bg }]}>
                              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
                                stroke={tone.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                {iconFor(g.type)}
                              </Svg>
                            </View>
                            <YStack flex={1}>
                              <Text fontSize={13.5} fontWeight="500" color={COLORS.text} numberOfLines={1}>
                                {a.name}
                              </Text>
                              <Text fontSize={10} color={COLORS.faint} marginTop={2} numberOfLines={1}>
                                {assetSubtitle(a)}
                              </Text>
                            </YStack>
                            <Text fontSize={14} fontWeight="600" color={debt ? COLORS.danger : COLORS.text}
                              style={MONEY_TEXT}>
                              {hideAmounts ? '· · ·' : `${debt ? '-' : ''}${amountText(Math.abs(a.currentAmount))}`}
                            </Text>
                          </XStack>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))
              )}
            </View>
          </View>

          <Text textAlign="center" fontSize={10} color={COLORS.faint} marginTop={16} marginBottom={8}>
            数据本机加密存储 · 仅你可解密查看
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** 负债类型判断（避免额外依赖，语义与 shared-utils isLiability 一致） */
function t3(type: AssetType): boolean {
  return type === 'debt';
}

function HomeSkeleton({ width, topInset }: { width: number; topInset: number }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <View style={{ height: topInset, backgroundColor: COLORS.paper }} />
      <OfflineBanner />
      <View style={{ paddingHorizontal: PAGE_PAD }}>
        <XStack justifyContent="space-between" alignItems="center" paddingTop={8} paddingBottom={16}>
          <YStack space={8}>
            <SkeletonBlock width={120} height={11} />
            <SkeletonBlock width={150} height={22} />
          </YStack>
          <SkeletonBlock width={40} height={40} radius={20} />
        </XStack>

        <GradientCard width={width} height={HERO_HEIGHT} radius={26}>
          <YStack flex={1} paddingHorizontal={24} paddingTop={24} paddingBottom={20} justifyContent="space-between">
            <SkeletonBlock width={110} height={12} color="rgba(255,255,255,0.45)" />
            <YStack space={10}>
              <SkeletonBlock width={210} height={36} color="rgba(255,255,255,0.85)" />
              <SkeletonBlock width={150} height={18} radius={999} color="rgba(255,255,255,0.26)" />
            </YStack>
            <SkeletonBlock width="100%" height={44} radius={8} color="rgba(255,255,255,0.12)" />
            <XStack space={12} justifyContent="space-between">
              {[0, 1, 2].map((i) => (
                <YStack key={i} flex={1} alignItems="center" space={6}>
                  <SkeletonBlock width={52} height={9} color="rgba(255,255,255,0.4)" />
                  <SkeletonBlock width={72} height={15} color="rgba(255,255,255,0.7)" />
                </YStack>
              ))}
            </XStack>
          </YStack>
        </GradientCard>

        <View style={{ height: 16 }} />
        <YStack padding={14} backgroundColor={COLORS.surface} borderRadius={20}
          borderColor={COLORS.hairlineSoft} borderWidth={1} flexDirection="row" alignItems="center" space={12}>
          <SkeletonBlock width={34} height={34} radius={11} color={COLORS.warningWash} />
          <SkeletonBlock width="70%" height={12} />
        </YStack>

        <View style={{ height: 24 }} />
        <SkeletonBlock width={84} height={17} />
        <View style={{ height: 8 }} />
        <YStack paddingHorizontal={16} paddingVertical={12} backgroundColor={COLORS.surface} borderRadius={20}
          borderColor={COLORS.hairlineSoft} borderWidth={1} space={16}>
          {[0, 1, 2].map((i) => (
            <XStack key={i} space={12} alignItems="center">
              <SkeletonBlock width={34} height={34} radius={11} />
              <YStack flex={1} space={6}>
                <SkeletonBlock width="55%" height={12} />
                <SkeletonBlock width="35%" height={9} />
              </YStack>
              <SkeletonBlock width={70} height={13} />
            </XStack>
          ))}
        </YStack>
      </View>
    </View>
  );
}

function SkeletonBlock({ width, height, radius = 6, color = COLORS.hairline }: {
  width: DimensionValue; height: number; radius?: number; color?: string;
}) {
  return <View style={{ width, height, borderRadius: radius, backgroundColor: color }} />;
}

const styles = {
  monthPill: {
    backgroundColor: GOLD_DECOR,
    borderWidth: 1,
    borderColor: GOLD_ON_INK,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pctPill: {
    backgroundColor: 'rgba(198,161,91,0.18)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hairlineGold: {
    height: 1,
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: 'rgba(198,161,91,0.30)',
  },
  heroColDivider: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(233,220,192,0.14)',
  },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
  },
  pillPrimary: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.inkSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
} as const;
