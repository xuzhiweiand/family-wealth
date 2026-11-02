/**
 * 资产详情页
 *
 * 显示：名称、类型、可见性、当前金额、最近 N 条快照
 * 操作：编辑（跳编辑页）/ 删除（软删，需 delete 权限）
 *
 * 权限：私有资产对非本人+非owner 显示「无权访问」（不暴露存在性之外的细节）。
 *       删除/编辑按钮按 packages/family 的 canDoOnAsset 裁决。
 */

import { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Text, XStack, YStack } from 'tamagui';
import { formatCNY, pctChange } from '@family-wealth/shared-utils';
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
  groupSnapshotsByMonth,
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
  manual: '手动',
  ocr: '拍照识别',
};

const RECENT_SNAPSHOT_LIMIT = 20;
const TREND_WINDOW_MONTHS = 6;

/** 增长标签配色（原型口径）：绿涨红跌 */
const GROWTH_UP = '#059669';
const GROWTH_DOWN = '#DC2626';

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
  // 全部快照（倒序）：趋势弹层与分组列表共用
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
  // 快照按「年-月」分组展示（0.3.0）
  const snapshotGroups = useMemo(() => groupSnapshotsByMonth(assetSnapshots), [assetSnapshots]);
  // 每条快照相对上一条（更早一条）的增减
  const snapshotDelta = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < allAssetSnapshots.length - 1; i++) {
      map.set(allAssetSnapshots[i]!.id, allAssetSnapshots[i]!.amount - allAssetSnapshots[i + 1]!.amount);
    }
    return map;
  }, [allAssetSnapshots]);

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

  // 路由参数缺失/资产不存在（可能刚被删、可能路由输错）
  if (!asset) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
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
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
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
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            {asset.name}
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => navigation.goBack()}>
            返回
          </Text>
        </XStack>

        <Card padded backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
          <Text fontSize="$2" color="$textSecondary">
            当前金额
          </Text>
          <Text fontSize="$8" fontWeight="700" color="$textPrimary">
            {formatCNY(asset.currentAmount)}
          </Text>
          <Text fontSize="$1" color="$textSecondary">
            创建于 {asset.createdAt.slice(0, 10)} · 最近更新 {asset.updatedAt.slice(0, 10)}
          </Text>
        </Card>

        <Card padded backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$md">
          <Text fontSize="$3" fontWeight="600" color="$textPrimary" marginBottom="$xs">
            属性
          </Text>
          <Row label="类型">{ASSET_TYPE_LABELS[asset.type] ?? asset.type}</Row>
          <Row label="可见性">
            {asset.visibility === 'private' ? `🔒 ${VISIBILITY_LABELS.private}` : VISIBILITY_LABELS.family}
          </Row>
          {getAssetNote(asset) ? (
            <Row label="备注">{getAssetNote(asset)}</Row>
          ) : null}
        </Card>

        <XStack space="$sm">
          <Button
            size={48}
            fontSize={16}
            flex={1}
            backgroundColor="#ECFDF5"
            color="#047857"
            borderColor="#A7F3D0"
            borderWidth={1}
            onPress={() => setShowTrend(true)}
          >
            趋势
          </Button>
          {canEdit ? (
            <Button
              size={48}
              fontSize={16}
              flex={1}
              onPress={() => navigation.navigate('AssetEdit', { id: asset.id })}
            >
              编辑
            </Button>
          ) : null}
          {canDelete ? (
            <Button size={48} fontSize={16} flex={1} backgroundColor="$debt" color="white" onPress={confirmAndRemove}>
              删除
            </Button>
          ) : null}
        </XStack>

        <XStack justifyContent="space-between" alignItems="center" marginTop="$sm">
          <Text fontSize="$3" fontWeight="600" color="$textPrimary">
            最近快照（{assetSnapshots.length}）
          </Text>
          <Text fontSize="$1" color="$textTertiary">按年月分组</Text>
        </XStack>
        {snapshotGroups.length === 0 ? (
          <Text fontSize="$2" color="$textSecondary">
            暂无快照记录
          </Text>
        ) : (
          snapshotGroups.map((g) => (
            <YStack key={g.month} space="$xs">
              {/* 组头：年月 + 条数 */}
              <XStack alignItems="center" space="$sm" paddingTop="$xs">
                <Text fontSize="$2" fontWeight="700" color="$textSecondary">{g.label}</Text>
                <XStack flex={1} height={1} backgroundColor="$border" />
                <Text fontSize="$1" color="$textTertiary">{g.items.length} 条</Text>
              </XStack>
              {g.items.map((s) => {
                const delta = snapshotDelta.get(s.id);
                return (
                  <Card
                    key={s.id}
                    padded
                    backgroundColor="$bgPrimary"
                    borderColor="$border"
                    borderWidth={1}
                    borderRadius="$md"
                  >
                    <XStack justifyContent="space-between" alignItems="center">
                      <YStack>
                        <Text fontSize="$3" fontWeight="600" color="$textPrimary">
                          {formatCNY(s.amount)}
                        </Text>
                        <Text fontSize="$1" color="$textSecondary">
                          {s.capturedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                          {SNAPSHOT_SOURCE_LABELS[s.source] ?? s.source}
                        </Text>
                      </YStack>
                      <YStack alignItems="flex-end" space="$xs">
                        {delta !== undefined ? (
                          <Text
                            fontSize="$1"
                            fontWeight="600"
                            color={delta >= 0 ? GROWTH_UP : GROWTH_DOWN}
                          >
                            {delta >= 0 ? '+' : ''}{formatCNY(delta)}
                          </Text>
                        ) : null}
                        {canEdit ? (
                          <Text
                            fontSize="$2"
                            color="$debt"
                            onPress={() => confirmAndRemoveSnapshot(s.id)}
                            hitSlop={8}
                          >
                            删除
                          </Text>
                        ) : null}
                      </YStack>
                    </XStack>
                  </Card>
                );
              })}
            </YStack>
          ))
        )}
      </YStack>

      {/* 近半年趋势弹层 */}
      <Modal visible={showTrend} transparent animationType="slide" onRequestClose={() => setShowTrend(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setShowTrend(false)}
        />
        <YStack
          backgroundColor="white"
          borderTopLeftRadius={24}
          borderTopRightRadius={24}
          padding="$lg"
          paddingBottom={insets.bottom + 24}
        >
          <XStack justifyContent="space-between" alignItems="center" marginBottom="$sm">
            <Text fontSize="$4" fontWeight="700" color="$textPrimary">
              {asset.name} · 近半年趋势
            </Text>
            <TouchableOpacity
              onPress={() => setShowTrend(false)}
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text fontSize="$2" color="$textSecondary">✕</Text>
            </TouchableOpacity>
          </XStack>
          <TrendChart data={trendSeries} height={160} lines={['netWorth']} showXLabels={false} />
          <MonthGrowthAxis items={trendGrowth} />
          <XStack space="$sm" marginTop="$md">
            <YStack flex={1} backgroundColor="#F9FAFB" borderRadius="$md" padding="$sm" alignItems="center">
              <Text fontSize="$1" color="$textTertiary">半年涨跌</Text>
              <Text
                fontSize="$3"
                fontWeight="700"
                color={trendSummary.delta === null ? '$textPrimary' : trendSummary.delta >= 0 ? GROWTH_UP : GROWTH_DOWN}
              >
                {trendSummary.delta === null ? '—' : `${trendSummary.delta >= 0 ? '+' : ''}${formatCNY(trendSummary.delta)}`}
              </Text>
            </YStack>
            <YStack flex={1} backgroundColor="#F9FAFB" borderRadius="$md" padding="$sm" alignItems="center">
              <Text fontSize="$1" color="$textTertiary">半年涨幅</Text>
              <Text
                fontSize="$3"
                fontWeight="700"
                color={trendSummary.pct === null ? '$textPrimary' : trendSummary.pct >= 0 ? GROWTH_UP : GROWTH_DOWN}
              >
                {trendSummary.pct === null ? '—' : `${trendSummary.pct >= 0 ? '+' : ''}${trendSummary.pct.toFixed(2)}%`}
              </Text>
            </YStack>
            <YStack flex={1} backgroundColor="#F9FAFB" borderRadius="$md" padding="$sm" alignItems="center">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$xs">
      <Text fontSize="$2" color="$textSecondary">
        {label}
      </Text>
      <Text fontSize="$2" color="$textPrimary">
        {children}
      </Text>
    </XStack>
  );
}
