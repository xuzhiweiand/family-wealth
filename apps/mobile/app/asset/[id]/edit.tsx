/**
 * 资产编辑页
 *
 * 字段：name / type / visibility / 金额
 * 保存策略：
 *   - 金额变更 → 走 updateAmount（同时写快照，数据模型 §C6）
 *   - 其他字段变更 → 走 updateAssetMeta
 *
 * 权限：canDoOnAsset(view)=false 整页禁用（虽然能进入说明权限已有，但
 *       路由层 race condition 兜底）；canDoOnAsset(edit)=false 也禁用。
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Input, Text, XStack, YStack } from 'tamagui';
import { ASSET_TYPES, type AssetType, type Visibility } from '@family-wealth/shared-types';
import { formatCNY } from '@family-wealth/shared-utils';
import { VISIBILITY_LABELS, canDoOnAsset } from '@family-wealth/family';
import { useAssetStore } from '../../../src/stores/asset-store';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useMyFamilyRole } from '../../../src/stores/family-store';

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
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

/** 元 → 分；非法输入返回 null（与录入页同款，避免两份 parse 逻辑漂移） */
function parseYuanToCents(text: string): number | null {
  const cleaned = text.replace(/[,\s¥￥元]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export default function EditAssetScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const updateAmount = useAssetStore((s) => s.updateAmount);
  const updateAssetMeta = useAssetStore((s) => s.updateAssetMeta);

  const asset = useMemo(() => assets.find((a) => a.id === id), [assets, id]);

  // 表单状态：amountText 初始为当前金额（Yuan 字符串），name/type/visibility 同理
  const [name, setName] = useState(asset?.name ?? '');
  const [type, setType] = useState<AssetType>(asset?.type ?? 'bank_deposit');
  const [visibility, setVisibility] = useState<Visibility>(asset?.visibility ?? 'family');
  const [amountText, setAmountText] = useState(
    asset ? (asset.currentAmount / 100).toFixed(2) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // asset 异步到达（首屏可能 store 还在 hydrate），name/type/visibility 也要随之回填
  useEffect(() => {
    if (!asset) return;
    setName(asset.name);
    setType(asset.type);
    setVisibility(asset.visibility);
    setAmountText((asset.currentAmount / 100).toFixed(2));
  }, [asset]);

  if (!asset) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            资产不存在
          </Text>
          <Button size="$3" theme="active" onPress={() => router.back()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  const isOwn = asset.ownerId === (user?.id ?? '');
  const canEdit = canDoOnAsset({ role: myRole, visibility: asset.visibility, isOwn }, 'edit');
  if (!canEdit) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ padding: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            无权编辑
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            你没有权限修改这条资产。
          </Text>
          <Button size="$3" theme="active" onPress={() => router.back()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  const cents = parseYuanToCents(amountText);

  // 字段变更检测
  const nameChanged = name.trim() !== asset.name;
  const typeChanged = type !== asset.type;
  const visibilityChanged = visibility !== asset.visibility;
  const amountChanged = cents !== null && cents !== asset.currentAmount;
  const hasMetaChange = nameChanged || typeChanged || visibilityChanged;
  const hasChange = hasMetaChange || amountChanged;

  async function save() {
    if (!asset) return;
    if (cents === null) {
      setError('金额格式不对');
      return;
    }
    if (name.trim() === '') {
      setError('名称不能为空');
      return;
    }
    if (!hasChange) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      if (hasMetaChange) {
        await updateAssetMeta(asset.id, {
          name: name.trim(),
          ...(typeChanged ? { type } : {}),
          ...(visibilityChanged ? { visibility } : {}),
        });
      }
      if (amountChanged) {
        await updateAmount(asset.id, cents, asset.familyId, 'manual');
      }
      router.back();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            编辑资产
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => router.back()}>
            取消
          </Text>
        </XStack>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            类型
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack space="$xs">
              {ASSET_TYPES.map((t) => (
                <Button
                  key={t}
                  size="$3"
                  theme={t === type ? 'active' : undefined}
                  backgroundColor={t === type ? '$primary' : '$bgPrimary'}
                  color={t === type ? 'white' : '$textPrimary'}
                  onPress={() => setType(t)}
                >
                  {ASSET_TYPE_LABELS[t]}
                </Button>
              ))}
            </XStack>
          </ScrollView>
        </YStack>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            名称
          </Text>
          <Input
            value={name}
            onChangeText={setName}
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
        </YStack>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            金额（元）
          </Text>
          <Input
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
          {cents !== null && amountChanged ? (
            <Text fontSize="$2" color="$primary">
              → {formatCNY(cents)}（将新增一条快照记录）
            </Text>
          ) : null}
        </YStack>

        <XStack
          backgroundColor="$bgPrimary"
          borderColor="$border"
          borderWidth={1}
          borderRadius="$md"
          padding="$sm"
          justifyContent="space-between"
          alignItems="center"
        >
          <YStack flex={1}>
            <Text fontSize="$3" color="$textPrimary">
              {VISIBILITY_LABELS[visibility]}
            </Text>
            <Text fontSize="$1" color="$textSecondary">
              {visibility === 'private'
                ? '其他家庭成员看不到这条资产，也不会计入家庭净资产'
                : '家庭成员都能看到、都会计入家庭净资产'}
            </Text>
          </YStack>
          <Switch
            value={visibility === 'private'}
            onValueChange={(v) => setVisibility(v ? 'private' : 'family')}
          />
        </XStack>

        {error !== null ? (
          <Text fontSize="$2" color="$debt">
            {error}
          </Text>
        ) : null}

        <Button
          size="$5"
          backgroundColor="$primary"
          color="white"
          disabled={saving || !hasChange || cents === null}
          onPress={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
      </YStack>
    </ScrollView>
  );
}
