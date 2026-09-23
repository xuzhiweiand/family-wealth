/**
 * 回收站：列出软删资产（deletedAt !== null），支持恢复 / 永久删除
 *
 * 软删机制（数据模型 §C7）保证误删可恢复，runbook §四 承诺了"设置 > 数据 > 回收站"
 * 自助恢复。这里是最简实现：只放本家庭 + 当前用户可见的软删资产。
 *
 * 永久删除是 P1（runbook §四 说要 DBA 介入 + 90 天后才走 PG point-in-time recovery），
 * 所以本页面只做"恢复"，不做"永久删除"。
 */

import { useEffect, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Text, XStack, YStack } from 'tamagui';
import { formatCNY } from '@family-wealth/shared-utils';
import { VISIBILITY_LABELS, filterVisibleAssets } from '@family-wealth/family';
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

export default function TrashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const restoreAsset = useAssetStore((s) => s.restoreAsset);

  // 1) 只看软删资产
  // 2) 走 filterVisibleAssets 过滤：owner 看所有，editor/viewer 看自己可见的
  const trashed = useMemo(
    () =>
      filterVisibleAssets(
        assets.filter((a) => a.deletedAt !== null),
        user?.id ?? '',
        myRole,
      ),
    [assets, user?.id, myRole],
  );

  // 进页提示：超过 90 天的软删数据按 runbook 不再自助恢复（这里只展示，不强制）
  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
      <YStack space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$6" fontWeight="700" color="$textPrimary">
            回收站
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => router.back()}>
            返回
          </Text>
        </XStack>

        <Text fontSize="$2" color="$textSecondary">
          删除的资产保留 90 天，可在此恢复。超期数据需联系管理员。
        </Text>

        {trashed.length === 0 ? (
          <Text fontSize="$2" color="$textSecondary" marginTop="$lg">
            回收站是空的。
          </Text>
        ) : (
          <Text fontSize="$3" fontWeight="600" color="$textPrimary" marginTop="$sm">
            已删除资产（{trashed.length}）
          </Text>
        )}

        {trashed.map((asset) => (
          <Card
            key={asset.id}
            padded
            backgroundColor="$bgPrimary"
            borderColor="$border"
            borderWidth={1}
            borderRadius="$md"
          >
            <XStack justifyContent="space-between" alignItems="center">
              <YStack flex={1}>
                <XStack space="$xs" alignItems="center">
                  <Text fontSize="$3" fontWeight="600" color="$textPrimary">
                    {asset.name}
                  </Text>
                  {asset.visibility === 'private' ? (
                    <Text fontSize="$1" color="$primary">
                      🔒 {VISIBILITY_LABELS.private}
                    </Text>
                  ) : null}
                </XStack>
                <Text fontSize="$1" color="$textSecondary">
                  {ASSET_TYPE_LABELS[asset.type] ?? asset.type} · 删除于{' '}
                  {asset.deletedAt?.slice(0, 10)}
                </Text>
              </YStack>
              <YStack alignItems="flex-end" space="$xs">
                <Text fontSize="$3" color="$textSecondary">
                  {formatCNY(asset.currentAmount)}
                </Text>
                <Button size={36} fontSize={14} onPress={() => void restoreAsset(asset.id)}>
                  恢复
                </Button>
              </YStack>
            </XStack>
          </Card>
        ))}
      </YStack>
    </ScrollView>
  );
}
