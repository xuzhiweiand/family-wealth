/**
 * 资产详情页（v0.6.0「私行墨绿 × 鎏金」单页复刻）
 *
 * 版式：页头（返回 / 资产详情 / 编辑）→ 类型芯片 + 名称 + 朱砂印章
 *       → 当前估值（眼睛显隐 + 环比）→ 近 6 个月迷你走势
 *       → 快照记录 → 资产信息（details 键值对）→ 底部操作。
 *
 * 业务不变：
 * - 编辑（跳 AssetEdit）/ 删除（软删回收站，需 delete 权限）
 * - 单条快照删除（需 edit 权限，删除后趋势回落到上一条）
 * - 近半年趋势弹层（月度序列 + 半年汇总）
 * - 私有资产对非本人 + 非 owner 显示「无权查看」，不暴露金额/名称细节
 *
 * 权限：编辑/删除按钮按 packages/family 的 canDoOnAsset 裁决。
 * 金额一律以「分」存储，展示走 formatCNY / formatCNYCompact。
 */

import { COLORS } from '../theme';
import { MONEY_TEXT, SERIF_CN_TEXT } from '../typography';
import { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, XStack, YStack } from 'tamagui';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { formatCNY, formatCNYCompact, pctChange } from '@family-wealth/shared-utils';
import { VISIBILITY_LABELS, canDoOnAsset } from '@family-wealth/family';
import { useAppNavigation, type RootStackParamList } from '../lib/navigation';
import { useAssetStore } from '../stores/asset-store';
import { useAuthStore } from '../stores/auth-store';
import { useMyFamilyRole } from '../stores/family-store';
import { getAssetNote } from '../services/export';
import { TrendChart } from '../components/TrendChart';
import { MonthGrowthAxis } from '../components/MonthGrowthAxis';
import {
  buildAssetMonthlySeries,
  buildMonthGrowthLabels,
  findPeak,
} from '../lib/asset-meta';

const ASSET_TYPE_LABELS: Record<string, string> = {
  cash: '现金',
  bank_deposit: '银行存款',
  stock: '股票',
  fund: '基金',
  wealth_management: '理财',
  real_estate: '房产',
  vehicle: '车辆',
  crypto: '数字货币',
  precious_metal: '贵金属',
  receivable: '债权',
  debt: '债务',
};

const SNAPSHOT_SOURCE_LABELS: Record<string, string> = {
  manual: '手动更新',
  ocr: '拍照识别',
  import: '导入',
  api: '接口同步',
};

/** details 里要展示的键值对（顺序即展示顺序） */
const DETAIL_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['bankName', '银行'],
  ['accountTail', '账号尾号'],
  ['term', '期限'],
  ['rate', '利率'],
  ['address', '地址'],
  ['area', '面积'],
  ['desc', '说明'],
];

const RECENT_SNAPSHOT_LIMIT = 20;
const TREND_WINDOW_MONTHS = 6;

/** 增长标签配色（原型口径）：绿涨红跌 */
const GROWTH_UP = COLORS.inkSoft;
const GROWTH_DOWN = COLORS.danger;

/** 迷你走势视口 */
const SPARK_W = 300;
const SPARK_H = 48;

/** 金额（分）→ '3,359,700'（不带 ¥，行内数字用） */
function amountText(cents: number): string {
  return formatCNY(cents, { fraction: false }).replace('¥', '');
}

/** 迷你趋势面积折线：映射到 SPARK_W × SPARK_H 视口 */
function sparkPaths(values: readonly number[]): {
  line: string;
  area: string;
  last: { x: number; y: number } | null;
} {
  if (values.length < 2) return { line: '', area: '', last: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (SPARK_W - 8) / (values.length - 1);
  const yOf = (v: number) => SPARK_H - 6 - ((v - min) / span) * (SPARK_H - 12);
  const coords = values.map(
    (v, i) => `${(4 + i * step).toFixed(1)},${yOf(v).toFixed(1)}`,
  );
  const line = `M${coords.join(' L')}`;
  const last = { x: 4 + (values.length - 1) * step, y: yOf(values[values.length - 1]!) };
  const area = `${line} L${last.x.toFixed(1)},${SPARK_H} L4,${SPARK_H} Z`;
  return { line, area, last };
}

export default function AssetDetailScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useRoute<RouteProp<RootStackParamList, 'AssetDetail'>>().params;
  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const removeSnapshot = useAssetStore((s) => s.removeSnapshot);

  const asset = useMemo(() => assets.find((a) => a.id === id), [assets, id]);
  // 全部快照（倒序）：趋势弹层与列表共用
  const allAssetSnapshots = useMemo(
    () =>
      snapshots
        .filter((s) => s.assetId === id)
        .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)),
    [snapshots, id],
  );
  const assetSnapshots = useMemo(
    () => allAssetSnapshots.slice(0, RECENT_SNAPSHOT_LIMIT),
    [allAssetSnapshots],
  );

  // 金额显隐（本地 state）
  const [hideAmount, setHideAmount] = useState(false);

  // 趋势弹层：近半年月度序列 + 半年汇总
  const [showTrend, setShowTrend] = useState(false);
  const trendSeries = useMemo(
    () => buildAssetMonthlySeries(id, snapshots, new Date(), TREND_WINDOW_MONTHS),
    [id, snapshots],
  );
  const trendGrowth = useMemo(
    () => buildMonthGrowthLabels(trendSeries, TREND_WINDOW_MONTHS),
    [trendSeries],
  );
  const trendSummary = useMemo(() => {
    const first = trendSeries[0];
    const last = trendSeries[trendSeries.length - 1];
    const windowStart = new Date();
    windowStart.setDate(1);
    windowStart.setMonth(windowStart.getMonth() - (TREND_WINDOW_MONTHS - 1));
    const records = allAssetSnapshots.filter(
      (s) => Date.parse(s.capturedAt) >= windowStart.getTime(),
    ).length;
    if (first === undefined || last === undefined || trendSeries.length < 2) {
      return { delta: null as number | null, pct: null as number | null, records };
    }
    return {
      delta: last.netWorth - first.netWorth,
      pct: pctChange(last.netWorth, first.netWorth),
      records,
    };
  }, [trendSeries, allAssetSnapshots]);

  // 近 6 个月最高点（迷你走势卡右上角）
  const peakAmount = useMemo(() => findPeak(trendSeries)?.amount ?? null, [trendSeries]);

  // 环比：当前估值 vs 上月末（carry-forward 口径，与趋势图一致）
  const momSeries = useMemo(
    () => buildAssetMonthlySeries(id, snapshots, new Date(), 2),
    [id, snapshots],
  );

  // 资产信息卡：可见性 + details 键值对 + 备注
  const infoRows = useMemo(() => {
    if (!asset) return [];
    const details: Record<string, unknown> = asset.details ?? {};
    const rows: Array<{ label: string; value: string }> = [];
    for (const [key, label] of DETAIL_FIELD_LABELS) {
      const raw = details[key];
      if (typeof raw === 'string' && raw.trim() !== '') {
        rows.push({ label, value: raw });
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        rows.push({ label, value: String(raw) });
      }
    }
    const note = getAssetNote(asset);
    if (note.trim() !== '') rows.push({ label: '备注', value: note });
    return [{ label: '可见性', value: VISIBILITY_LABELS[asset.visibility] }, ...rows];
  }, [asset]);

  // 路由参数缺失/资产不存在（可能刚被删、可能路由输错）
  if (!asset) {
    return (
      <ScrollView style={{ backgroundColor: COLORS.paper }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            资产不存在
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            可能已被删除，或链接已失效。
          </Text>
          <Button size={44} fontSize={16} onPress={() => navigation.goBack()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  const isOwn = asset.ownerId === (user?.id ?? '');
  // 1) 先做 view 权限裁决
  const canView = canDoOnAsset({ role: myRole, visibility: asset.visibility, isOwn }, 'view');
  if (!canView) {
    // 私有资产对非本人+非owner：只挡，不暴露金额/名称细节
    return (
      <ScrollView style={{ backgroundColor: COLORS.paper }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            无权查看
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            该资产仅对创建者本人与家庭管理员可见。
          </Text>
          <Button size={44} fontSize={16} onPress={() => navigation.goBack()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  const canEdit = canDoOnAsset({ role: myRole, visibility: asset.visibility, isOwn }, 'edit');
  const canDelete = canDoOnAsset({ role: myRole, visibility: asset.visibility, isOwn }, 'delete');

  const prevMonthAmount = momSeries.length >= 2 ? momSeries[0]!.netWorth : null;
  const momDelta = prevMonthAmount === null ? null : asset.currentAmount - prevMonthAmount;
  const momPct =
    prevMonthAmount === null || prevMonthAmount === 0
      ? null
      : pctChange(asset.currentAmount, prevMonthAmount);

  const spark = sparkPaths(trendSeries.map((p) => p.netWorth));

  function openEdit() {
    if (!asset) return;
    navigation.navigate('AssetEdit', { id: asset.id });
  }

  function confirmAndRemove() {
    if (!asset) return;
    Alert.alert('删除资产', `删除「${asset.name}」？删除后可在回收站恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void removeAsset(asset.id);
          navigation.goBack();
        },
      },
    ]);
  }

  function confirmAndRemoveSnapshot(snapshotId: string) {
    Alert.alert('删除快照', '删除后趋势曲线会回落到上一条快照，确定删除？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void removeSnapshot(snapshotId);
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.paper }}
      contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* 页头：返回 / 资产详情 / 编辑 */}
      <XStack alignItems="center" paddingHorizontal={20} paddingTop={4} paddingBottom={12}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityLabel="返回"
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
            stroke={COLORS.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Path d="m15 18-6-6 6-6" />
          </Svg>
        </TouchableOpacity>
        <Text flex={1} textAlign="center" fontSize={17} fontWeight="600" color={COLORS.text}
          letterSpacing={0.8} style={SERIF_CN_TEXT}>
          资产详情
        </Text>
        {canEdit ? (
          <TouchableOpacity onPress={openEdit} hitSlop={10} style={styles.editHit}>
            <Text fontSize={13} fontWeight="600" color={COLORS.goldDeep}>编辑</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.editHit} />
        )}
      </XStack>

      {/* 类型芯片 + 名称 + 朱砂印章 */}
      <XStack alignItems="center" paddingHorizontal={24} marginTop={4}>
        <XStack flex={1} alignItems="center" space={12}>
          <View style={styles.iconChip}>
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none"
              stroke={COLORS.goldDeep} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M3 3v16a2 2 0 0 0 2 2h16" />
              <Path d="m19 9-5 5-4-4-3 3" />
            </Svg>
          </View>
          <YStack flex={1}>
            <Text fontSize={10} color={COLORS.faint} letterSpacing={2} numberOfLines={1}>
              {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
            </Text>
            <Text fontSize={21} lineHeight={28} color={COLORS.text} letterSpacing={0.6}
              marginTop={4} numberOfLines={2} style={SERIF_CN_TEXT}>
              {asset.name}
            </Text>
          </YStack>
        </XStack>
        <View style={styles.seal}>
          <Text fontSize={11} color={COLORS.inkWash} style={SERIF_CN_TEXT}>资产</Text>
        </View>
      </XStack>

      {/* 当前估值 + 环比 */}
      <YStack paddingHorizontal={24} marginTop={22}>
        <Text fontSize={10.5} color={COLORS.faint} letterSpacing={3}>
          当前估值（元）
        </Text>
        <XStack alignItems="flex-end" marginTop={6}>
          <Text fontSize={36} lineHeight={42} fontWeight="600" color={COLORS.text}
            numberOfLines={1} flexShrink={1} style={MONEY_TEXT}>
            {hideAmount ? '¥ · · · · · ·' : formatCNY(asset.currentAmount, { fraction: false })}
          </Text>
          <TouchableOpacity
            onPress={() => setHideAmount((v) => !v)}
            hitSlop={10}
            activeOpacity={0.7}
            style={styles.eyeBtn}
            accessibilityLabel={hideAmount ? '显示金额' : '隐藏金额'}
          >
            <Svg width={19} height={19} viewBox="0 0 24 24" fill="none"
              stroke={COLORS.faint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              {hideAmount ? (
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

        <XStack alignItems="center" space={6} marginTop={8}>
          <TrendGlyph up={momDelta !== null && momDelta >= 0} />
          {hideAmount ? (
            <Text fontSize={11.5} color={COLORS.faint}>较上月 · · ·</Text>
          ) : momDelta === null ? (
            <Text fontSize={11.5} color={COLORS.faint}>较上月 —</Text>
          ) : (
            <Text fontSize={11.5} fontWeight="600"
              color={momDelta >= 0 ? COLORS.success : COLORS.danger}>
              较上月{' '}
              <Text fontSize={11.5} fontWeight="600" color={momDelta >= 0 ? COLORS.success : COLORS.danger} style={MONEY_TEXT}>
                {momDelta >= 0 ? '+' : '-'}{amountText(Math.abs(momDelta))}
              </Text>
              {' · '}
              <Text fontSize={11.5} fontWeight="600" color={momDelta >= 0 ? COLORS.success : COLORS.danger} style={MONEY_TEXT}>
                {momPct === null ? '—' : `${momPct >= 0 ? '+' : ''}${momPct.toFixed(2)}%`}
              </Text>
            </Text>
          )}
        </XStack>
      </YStack>

      {/* 近 6 个月迷你走势 */}
      <YStack paddingHorizontal={24} marginTop={16}>
        <View style={styles.card}>
          <YStack padding={16}>
            <XStack justifyContent="space-between" alignItems="center" marginBottom={10}>
              <Text fontSize={10} color={COLORS.faint} letterSpacing={2}>
                近 {TREND_WINDOW_MONTHS} 个月
              </Text>
              <Text fontSize={10} color={COLORS.goldDeep} style={MONEY_TEXT}>
                最高 {hideAmount ? '· · ·' : peakAmount === null ? '—' : formatCNYCompact(peakAmount)}
              </Text>
            </XStack>
            {spark.line === '' ? (
              <View style={styles.sparkEmpty}>
                <Text fontSize={11} color={COLORS.faint}>暂无足够走势数据</Text>
              </View>
            ) : (
              <Svg width="100%" height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
                <Defs>
                  <LinearGradient id="detailSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={COLORS.gold} stopOpacity={0.22} />
                    <Stop offset="1" stopColor={COLORS.gold} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {[16, 30, 42].map((y) => (
                  <Line key={`grid-${y}`} x1={4} x2={SPARK_W - 4} y1={y} y2={y}
                    stroke={COLORS.divider} strokeWidth={1} />
                ))}
                <Path d={spark.area} fill="url(#detailSparkFill)" />
                <Path d={spark.line} fill="none" stroke={COLORS.gold} strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" />
                {spark.last !== null ? (
                  <Circle cx={spark.last.x} cy={spark.last.y} r={3.5}
                    fill={COLORS.gold} stroke={COLORS.surface} strokeWidth={1.5} />
                ) : null}
              </Svg>
            )}
            <TouchableOpacity onPress={() => setShowTrend(true)} activeOpacity={0.7}
              style={styles.trendLink}>
              <Text fontSize={11.5} fontWeight="600" color={COLORS.ink}>查看完整趋势</Text>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke={COLORS.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <Path d="m9 18 6-6-6-6" />
              </Svg>
            </TouchableOpacity>
          </YStack>
        </View>
      </YStack>

      {/* 快照记录 */}
      <YStack paddingHorizontal={24} marginTop={20}>
        <XStack justifyContent="space-between" alignItems="baseline" marginBottom={8}>
          <Text fontSize={17} color={COLORS.text} letterSpacing={0.6} style={SERIF_CN_TEXT}>
            快照记录
          </Text>
          <Text fontSize={10.5} color={COLORS.faint}>共 {allAssetSnapshots.length} 条</Text>
        </XStack>
        <View style={styles.card}>
          <View style={styles.cardInner}>
            {assetSnapshots.length === 0 ? (
              <Text fontSize={12} color={COLORS.faint} paddingVertical={20}>
                暂无快照记录
              </Text>
            ) : (
              assetSnapshots.map((s, idx) => {
                const latest = idx === 0;
                const isLast = idx === assetSnapshots.length - 1;
                return (
                  <XStack
                    key={s.id}
                    alignItems="center"
                    justifyContent="space-between"
                    paddingVertical={12}
                    borderBottomWidth={isLast ? 0 : 1}
                    borderBottomColor={COLORS.divider}
                  >
                    <Text fontSize={12} color={COLORS.sub} flexShrink={1} numberOfLines={1}>
                      {s.capturedAt.slice(5, 10)} {SNAPSHOT_SOURCE_LABELS[s.source] ?? s.source}
                    </Text>
                    <XStack alignItems="center">
                      {latest ? <View style={styles.latestDot} /> : null}
                      <Text
                        fontSize={14}
                        fontWeight={latest ? '700' : '600'}
                        color={latest ? COLORS.ink : COLORS.text}
                        style={MONEY_TEXT}
                      >
                        {amountText(s.amount)}
                      </Text>
                      {canEdit ? (
                        <TouchableOpacity
                          onPress={() => confirmAndRemoveSnapshot(s.id)}
                          hitSlop={10}
                          style={styles.rowDelete}
                        >
                          <Text fontSize={10.5} color={COLORS.danger}>删除</Text>
                        </TouchableOpacity>
                      ) : null}
                    </XStack>
                  </XStack>
                );
              })
            )}
          </View>
        </View>
      </YStack>

      {/* 资产信息（details 键值对） */}
      <YStack paddingHorizontal={24} marginTop={20}>
        <Text fontSize={17} color={COLORS.text} letterSpacing={0.6} marginBottom={8} style={SERIF_CN_TEXT}>
          资产信息
        </Text>
        <View style={styles.card}>
          <View style={styles.cardInner}>
            {infoRows.map((row, idx) => {
              const isLast = idx === infoRows.length - 1;
              return (
                <XStack
                  key={`${row.label}-${idx}`}
                  justifyContent="space-between"
                  alignItems="flex-start"
                  gap={16}
                  paddingVertical={11}
                  borderBottomWidth={isLast ? 0 : 1}
                  borderBottomColor={COLORS.divider}
                >
                  <Text fontSize={10} color={COLORS.faint} letterSpacing={0.5} paddingTop={2}>
                    {row.label}
                  </Text>
                  <Text fontSize={12} lineHeight={17} color={COLORS.text} flex={1} textAlign="right">
                    {row.value}
                  </Text>
                </XStack>
              );
            })}
          </View>
        </View>
      </YStack>

      {/* 底部操作 */}
      {canEdit ? (
        <YStack paddingHorizontal={24} marginTop={22} space={10}>
          <TouchableOpacity activeOpacity={0.82} onPress={openEdit} style={styles.primaryBtn}>
            <Text fontSize={14} fontWeight="600" color={COLORS.paper} letterSpacing={2}>
              更新估值
            </Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.82} onPress={openEdit} style={styles.secondaryBtn}>
            <Text fontSize={14} fontWeight="600" color={COLORS.goldDeep} letterSpacing={2}>
              编辑资产
            </Text>
          </TouchableOpacity>
        </YStack>
      ) : null}
      {canDelete ? (
        <TouchableOpacity onPress={confirmAndRemove} hitSlop={12} style={styles.trashBtn}>
          <Text fontSize={12} color={COLORS.danger} letterSpacing={1}>移至回收站</Text>
        </TouchableOpacity>
      ) : null}

      {/* 近半年趋势弹层 */}
      <Modal visible={showTrend} transparent animationType="slide" onRequestClose={() => setShowTrend(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(7,42,31,0.48)' }}
          activeOpacity={1}
          onPress={() => setShowTrend(false)}
        />
        <YStack
          backgroundColor={COLORS.surface}
          borderTopLeftRadius={24}
          borderTopRightRadius={24}
          padding="$lg"
          paddingBottom={insets.bottom + 24}
        >
          <XStack justifyContent="space-between" alignItems="center" marginBottom="$sm">
            <Text fontSize="$4" fontWeight="700" color={COLORS.text} style={SERIF_CN_TEXT} letterSpacing={0.4}>
              {asset.name} · 近半年趋势
            </Text>
            <TouchableOpacity
              onPress={() => setShowTrend(false)}
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: COLORS.divider, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text fontSize="$2" color="$textSecondary">✕</Text>
            </TouchableOpacity>
          </XStack>
          <TrendChart data={trendSeries} height={160} lines={['netWorth']} showXLabels={false} />
          <MonthGrowthAxis items={trendGrowth} />
          <XStack space="$sm" marginTop="$md">
            <YStack flex={1} backgroundColor={COLORS.paper} borderRadius="$md" padding="$sm" alignItems="center">
              <Text fontSize="$1" color="$textTertiary">半年涨跌</Text>
              <Text
                fontSize="$3"
                fontWeight="700"
                color={trendSummary.delta === null ? '$textPrimary' : trendSummary.delta >= 0 ? GROWTH_UP : GROWTH_DOWN}
              >
                {trendSummary.delta === null ? '—' : `${trendSummary.delta >= 0 ? '+' : ''}${formatCNY(trendSummary.delta)}`}
              </Text>
            </YStack>
            <YStack flex={1} backgroundColor={COLORS.paper} borderRadius="$md" padding="$sm" alignItems="center">
              <Text fontSize="$1" color="$textTertiary">半年涨幅</Text>
              <Text
                fontSize="$3"
                fontWeight="700"
                color={trendSummary.pct === null ? '$textPrimary' : trendSummary.pct >= 0 ? GROWTH_UP : GROWTH_DOWN}
              >
                {trendSummary.pct === null ? '—' : `${trendSummary.pct >= 0 ? '+' : ''}${trendSummary.pct.toFixed(2)}%`}
              </Text>
            </YStack>
            <YStack flex={1} backgroundColor={COLORS.paper} borderRadius="$md" padding="$sm" alignItems="center">
              <Text fontSize="$1" color="$textTertiary">记录次数</Text>
              <Text fontSize="$3" fontWeight="700" color="$textPrimary">
                {trendSummary.records} 次
              </Text>
            </YStack>
          </XStack>
        </YStack>
      </Modal>
    </ScrollView>
  );
}

/** 环比趋势图标（金色，上涨 / 下跌） */
function TrendGlyph({ up }: { up: boolean }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke={COLORS.gold} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {up ? (
        <>
          <Path d="m22 7-8.5 8.5L8.5 10.5 2 17" />
          <Path d="M16 7h6v6" />
        </>
      ) : (
        <>
          <Path d="m22 17-8.5-8.5L8.5 13.5 2 7" />
          <Path d="M16 17h6v-6" />
        </>
      )}
    </Svg>
  );
}

const styles = {
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editHit: {
    width: 36,
    alignItems: 'flex-end',
  },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(198,161,91,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seal: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    transform: [{ rotate: '-3deg' }],
  },
  eyeBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginBottom: 4,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardInner: {
    paddingHorizontal: 16,
  },
  sparkEmpty: {
    height: SPARK_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendLink: {
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(11,61,46,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
  },
  latestDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
    marginRight: 6,
  },
  rowDelete: {
    marginLeft: 12,
  },
  primaryBtn: {
    height: 46,
    borderRadius: 16,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.inkDeep,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  secondaryBtn: {
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gold,
    backgroundColor: COLORS.transparent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBtn: {
    marginTop: 18,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
} as const;
