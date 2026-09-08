/**
 * 资产详情页
 *
 * 显示：名称、类型、可见性、当前金额、最近 N 条快照
 * 操作：编辑（跳编辑页）/ 删除（软删，需 delete 权限）
 *
 * 权限：私有资产对非本人+非owner 显示「无权访问」（不暴露存在性之外的细节）。
 *       删除/编辑按钮按 packages/family 的 canDoOnAsset 裁决。
 */

import { useEffect, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Text, XStack, YStack } from 'tamagui';
import { formatCNY } from '@family-wealth/shared-utils';
import { VISIBILITY_LABELS, canDoOnAsset } from '@family-wealth/family';
import { useAssetStore } from '../../src/stores/asset-store';
import { useAuthStore } from '../../src/stores/auth-store';
import { useMyFamilyRole } from '../../src/stores/family-store';

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

export default function AssetDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const removeAsset = useAssetStore((s) => s.removeAsset);

  const asset = useMemo(() => assets.find((a) => a.id === id), [assets, id]);
  const assetSnapshots = useMemo(
    () =>
      snapshots
        .filter((s) => s.assetId === id)
        .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))
        .slice(0, RECENT_SNAPSHOT_LIMIT),
    [snapshots, id],
  );

  // 路由参数缺失/资产不存在（可能刚被删、可能路由输错）
  if (!asset) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            资产不存在
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            可能已被删除，或链接已失效。
          </Text>
          <Button size="$3" theme="active" onPress={() => router.back()}>
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
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            无权查看
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            该资产仅对创建者本人与家庭管理员可见。
          </Text>
          <Button size="$3" theme="active" onPress={() => router.back()}>
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
    // 真机上接 Alert.alert；这里先简单 confirm 占位
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`删除「${asset!.name}」？此操作可从回收站恢复`)) {
      void removeAsset(asset!.id);
      router.back();
    }
  }

  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            {asset.name}
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => router.back()}>
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
        </Card>

        <XStack space="$sm">
          {canEdit ? (
            <Button
              size="$4"
              flex={1}
              theme="active"
              onPress={() => router.push(`/asset/${asset.id}/edit`)}
            >
              编辑
            </Button>
          ) : null}
          {canDelete ? (
            <Button size="$4" flex={1} backgroundColor="$debt" color="white" onPress={confirmAndRemove}>
              删除
            </Button>
          ) : null}
        </XStack>

        <Text fontSize="$3" fontWeight="600" color="$textPrimary" marginTop="$sm">
          最近快照（{assetSnapshots.length}）
        </Text>
        {assetSnapshots.length === 0 ? (
          <Text fontSize="$2" color="$textSecondary">
            暂无快照记录
          </Text>
        ) : (
          assetSnapshots.map((s) => (
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
              </XStack>
            </Card>
          ))
        )}
      </YStack>
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
