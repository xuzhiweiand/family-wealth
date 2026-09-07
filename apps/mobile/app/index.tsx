/**
 * 仪表盘：净资产 + 环比 + 趋势图 + 资产列表
 *
 * 所有聚合都在本机完成（服务端只见密文，见 ADR-0006）：
 * 快照 → packages/analytics 聚合成趋势序列 → 这里只负责画。
 */

import { useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, Text, XStack, YStack } from 'tamagui';
import { buildTrendSeries, summarizeTrend } from '@family-wealth/analytics';
import { formatCNY, formatCNYCompact, formatPct } from '@family-wealth/shared-utils';
import { useAuthStore } from '../src/stores/auth-store';
import { useKeyStore } from '../src/stores/key-store';
import { useAssetStore } from '../src/stores/asset-store';
import { useFamilyStore } from '../src/stores/family-store';
import { TrendChart } from '../src/components/TrendChart';

/** A 股习惯：涨红跌绿 */
const UP_COLOR = '#DC2626';
const DOWN_COLOR = '#16A34A';

const TREND_WINDOW_DAYS = 90;

function fromDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const umk = useKeyStore((s) => s.umk);
  const storedFamilyId = useKeyStore((s) => s.familyId);
  const sharedFamily = useFamilyStore((s) => s.family);

  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const loading = useAssetStore((s) => s.loading);
  const load = useAssetStore((s) => s.load);

  // 加入/创建家庭后用真实家庭 id；W2 的 mock 登录兜底 demo-family 保证 UI 可跑
  const familyId = sharedFamily?.id ?? storedFamilyId ?? 'demo-family';

  useEffect(() => {
    void load(familyId);
  }, [familyId, load]);

  const activeAssets = useMemo(() => assets.filter((a) => a.deletedAt === null), [assets]);

  const series = useMemo(
    () => buildTrendSeries(snapshots, activeAssets, { from: fromDaysAgo(TREND_WINDOW_DAYS), familyId }),
    [snapshots, activeAssets, familyId],
  );

  const summary = useMemo(() => summarizeTrend(series, 30), [series]);

  const netWorth = summary.latest?.netWorth ?? 0;
  const up = summary.changeAmount >= 0;

  return (
    <YStack flex={1} backgroundColor="$bgSecondary" padding="$lg" space="$md">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontSize="$5" fontWeight="700" color="$textPrimary">
          {user?.displayName ?? '我的家庭'}
        </Text>
        <Text fontSize="$2" color="$primary" pressStyle={{ opacity: 0.6 }} onPress={() => void signOut()}>
          退出
        </Text>
      </XStack>

      <Card padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
        <Text fontSize="$2" color="$textSecondary">
          净资产
        </Text>
        <Text fontSize="$8" fontWeight="700" color="$textPrimary">
          {formatCNY(netWorth)}
        </Text>
        <XStack space="$sm" alignItems="center">
          <Text fontSize="$3" fontWeight="600" color={up ? UP_COLOR : DOWN_COLOR}>
            {up ? '▲' : '▼'} {formatPct(summary.changePct)}
          </Text>
          <Text fontSize="$1" color="$textSecondary">
            近 30 天 {up ? '+' : ''}
            {formatCNYCompact(summary.changeAmount)}
          </Text>
        </XStack>
        <XStack space="$md" marginTop="$xs">
          <Text fontSize="$1" color="$textSecondary">
            总资产 {formatCNYCompact(summary.latest?.totalAssets ?? 0)}
          </Text>
          <Text fontSize="$1" color="$textSecondary">
            负债 {formatCNYCompact(summary.latest?.totalLiabilities ?? 0)}
          </Text>
        </XStack>
      </Card>

      <Card padded elevate backgroundColor="$bgPrimary" borderColor="$border" borderWidth={1} borderRadius="$lg">
        <Text fontSize="$3" color="$textSecondary" marginBottom="$xs">
          近 {TREND_WINDOW_DAYS} 天趋势
        </Text>
        <TrendChart data={series} height={150} lines={['netWorth', 'totalAssets', 'totalLiabilities']} />
      </Card>

      <XStack justifyContent="space-between" alignItems="center">
        <Text fontSize="$4" fontWeight="600" color="$textPrimary">
          资产列表
        </Text>
        <XStack space="$sm">
          <Button size="$3" theme="active" onPress={() => router.push('/family')}>
            家庭
          </Button>
          <Button size="$3" backgroundColor="$primary" color="white" onPress={() => router.push('/asset/new')}>
            + 录入
          </Button>
        </XStack>
      </XStack>

      {loading ? (
        <Text fontSize="$2" color="$textSecondary">
          加载中…
        </Text>
      ) : null}

      {activeAssets.length === 0 && !loading ? (
        <Text fontSize="$2" color="$textSecondary">
          还没有资产，点「+ 录入」添加第一笔（可以拍照识别金额）
        </Text>
      ) : null}

      {activeAssets.map((asset) => (
        <Card
          key={asset.id}
          padded
          elevate
          backgroundColor="$bgPrimary"
          borderColor="$border"
          borderWidth={1}
          borderRadius="$md"
        >
          <XStack justifyContent="space-between" alignItems="center">
            <YStack>
              <Text fontSize="$4" fontWeight="600" color="$textPrimary">
                {asset.name}
              </Text>
              <Text fontSize="$1" color="$textSecondary">
                {asset.type}
              </Text>
            </YStack>
            <Text fontSize="$4" color={asset.type === 'debt' ? UP_COLOR : '$textPrimary'}>
              {formatCNY(asset.currentAmount)}
            </Text>
          </XStack>
        </Card>
      ))}

      <Text fontSize="$1" color="$textSecondary">
        UMK：{umk === null ? '未派生' : '已派生 ✓'} · 数据仅存本机，同步时以密文上行
      </Text>
    </YStack>
  );
}
