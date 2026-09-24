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
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Card, Input, Text, XStack, YStack } from 'tamagui';
import { SELECTABLE_ASSET_TYPES, type AssetType, type Visibility } from '@family-wealth/shared-types';
import { formatCNY } from '@family-wealth/shared-utils';
import { VISIBILITY_LABELS, canDoOnAsset } from '@family-wealth/family';
import { useAppNavigation, type RootStackParamList } from '../lib/navigation';
import { useAssetStore } from '../stores/asset-store';
import { useAuthStore } from '../stores/auth-store';
import { useMyFamilyRole } from '../stores/family-store';
import { getAssetNote } from '../services/export';
import { todayDate, dateToNoonIso, formatDate } from './AssetNewScreen';

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
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useRoute<RouteProp<RootStackParamList, 'AssetEdit'>>().params;
  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
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
  const [note, setNote] = useState(asset ? getAssetNote(asset) : '');
  // 记账日期：回填该资产最新快照的日期（无快照则当天）；修改后将写一条该日期的余额快照
  const [date, setDate] = useState<Date>(todayDate);
  const [initialDate, setInitialDate] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestCapturedAt = useMemo(() => {
    const list = snapshots
      .filter((s) => s.assetId === id)
      .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
    return list[0]?.capturedAt ?? null;
  }, [snapshots, id]);

  useEffect(() => {
    const fallback = todayDate();
    const d = latestCapturedAt ? new Date(latestCapturedAt) : fallback;
    const safe = Number.isNaN(d.getTime()) ? fallback : d;
    setDate(safe);
    setInitialDate(formatDate(safe));
  }, [latestCapturedAt]);

  // asset 异步到达（首屏可能 store 还在 hydrate），name/type/visibility 也要随之回填
  useEffect(() => {
    if (!asset) return;
    setName(asset.name);
    setType(asset.type);
    setVisibility(asset.visibility);
    setAmountText((asset.currentAmount / 100).toFixed(2));
    setNote(getAssetNote(asset));
  }, [asset]);

  if (!asset) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            资产不存在
          </Text>
          <Button size={44} fontSize={16} onPress={() => navigation.goBack()}>
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
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            无权编辑
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            你没有权限修改这条资产。
          </Text>
          <Button size={44} fontSize={16} onPress={() => navigation.goBack()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  const cents = parseYuanToCents(amountText);

  // 类型选项：收敛后的可选类型；历史资产若是已下架类型，保留该选项供显示
  // （普通表达式而非 hook：本组件在 asset 未就绪时会提前 return，不能有条件 hook）
  const typeOptions: readonly AssetType[] = (SELECTABLE_ASSET_TYPES as readonly AssetType[]).includes(type)
    ? SELECTABLE_ASSET_TYPES
    : [type, ...SELECTABLE_ASSET_TYPES];

  // 字段变更检测
  const nameChanged = name.trim() !== asset.name;
  const typeChanged = type !== asset.type;
  const visibilityChanged = visibility !== asset.visibility;
  const amountChanged = cents !== null && cents !== asset.currentAmount;
  const dateChanged = initialDate !== null && formatDate(date) !== initialDate;
  const noteChanged = note.trim() !== getAssetNote(asset);
  const hasMetaChange = nameChanged || typeChanged || visibilityChanged || noteChanged;
  // 日期被修改时，即使金额没变也写一条该日余额快照（确认余额）
  const hasChange = hasMetaChange || amountChanged || dateChanged;

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
      navigation.goBack();
      return;
    }
    const capturedAt = dateToNoonIso(date);
    setSaving(true);
    try {
      if (hasMetaChange) {
        await updateAssetMeta(asset.id, {
          name: name.trim(),
          ...(typeChanged ? { type } : {}),
          ...(visibilityChanged ? { visibility } : {}),
          ...(noteChanged
            ? { details: { ...asset.details, note: note.trim() } }
            : {}),
        });
      }
      if (amountChanged || dateChanged) {
        await updateAmount(asset.id, cents, asset.familyId, 'manual', capturedAt);
      }
      navigation.goBack();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            编辑资产
          </Text>
          <Text fontSize="$2" color="$primary" onPress={() => navigation.goBack()}>
            取消
          </Text>
        </XStack>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            类型
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack space="$xs">
              {typeOptions.map((t) => (
                <Button
                  key={t}
                  size={36}
                  fontSize={14}
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
            height={48}
            fontSize={16}
            paddingHorizontal={16}
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
            height={48}
            fontSize={16}
            paddingHorizontal={16}
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

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            记账日期
          </Text>
          <Button
            size={48}
            fontSize={16}
            justifyContent="flex-start"
            paddingHorizontal={16}
            backgroundColor="$bgPrimary"
            color="$textPrimary"
            borderColor="$border"
            borderWidth={1}
            onPress={() => setShowDatePicker(true)}
          >
            {formatDate(date)}
          </Button>
          {showDatePicker ? (
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              onChange={(event, d) => {
                setShowDatePicker(false);
                if (d) setDate(d);
              }}
            />
          ) : null}
          <Text fontSize="$1" color="$textSecondary">
            修改日期会记录一条该日余额快照（可补录历史）
          </Text>
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
            value={visibility === 'family'}
            onValueChange={(v) => setVisibility(v ? 'family' : 'private')}
          />
        </XStack>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            备注
          </Text>
          <Input
            value={note}
            onChangeText={setNote}
            placeholder="账号、开户行、到期日等（可选）"
            placeholderTextColor="$textTertiary"
            multiline
            minHeight={72}
            verticalAlign="top"
            padding="$sm"
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
        </YStack>

        {error !== null ? (
          <Text fontSize="$2" color="$debt">
            {error}
          </Text>
        ) : null}

        <Button
          size={52}
          fontSize={18}
          marginTop={12}
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
