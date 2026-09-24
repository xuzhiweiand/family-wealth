/**
 * 资产录入页
 *
 * 两种录入方式：
 * 1. 手动输入金额
 * 2. 拍照 → 端侧 OCR → 从识别结果里挑一个金额候选（ADR-0008）
 *
 * 无论哪种，保存时都会同时写一条快照（source 分别记 manual / ocr），
 * 供趋势图使用。
 */

import { useState } from 'react';
import { ScrollView, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Input, Text, XStack, YStack } from 'tamagui';
import { SELECTABLE_ASSET_TYPES, type AssetType, type Visibility } from '@family-wealth/shared-types';
import { formatCNY } from '@family-wealth/shared-utils';
import type { AmountCandidate } from '@family-wealth/ocr';
import { can, VISIBILITY_LABELS } from '@family-wealth/family';
import { useAssetStore } from '../../src/stores/asset-store';
import { useAuthStore } from '../../src/stores/auth-store';
import { useKeyStore } from '../../src/stores/key-store';
import { useMyFamilyRole } from '../../src/stores/family-store';
import { getOcrEngine } from '../../src/services/ocr';

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

/** 用户输入的「元」→「分」；非法输入返回 null */
export function parseYuanToCents(text: string): number | null {
  const cleaned = text.replace(/[,\s¥￥元]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** YYYY-MM-DD（本地时区显示格式） */
export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时区的今天（零点） */
export function todayDate(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 取当天正午转 ISO——正午规避 UTC 显示日期偏移（东八区 12:00 → 04:00Z，同日；
 *  若取零点会显示成前一天） */
export function dateToNoonIso(d: Date): string {
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  return noon.toISOString();
}

export default function NewAssetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const familyId = useKeyStore((s) => s.familyId);
  const addAsset = useAssetStore((s) => s.addAsset);
  const myRole = useMyFamilyRole();
  const canCreate = can(myRole, 'create_asset');

  const [type, setType] = useState<AssetType>('bank_deposit');
  // 名称默认值跟随类型名；用户手动输入过后不再自动覆盖
  const [name, setName] = useState(ASSET_TYPE_LABELS['bank_deposit']);
  const [nameEdited, setNameEdited] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState<Date>(todayDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [candidates, setCandidates] = useState<AmountCandidate[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromOcr, setFromOcr] = useState(false);

  const cents = parseYuanToCents(amountText);

  // viewer：无 create_asset 能力，整页禁用并给一句解释（不直接回退，
  // 让用户知道为什么不能录入——产品反馈 W2 原型就嫌黑盒）
  if (!canCreate) {
    return (
      <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: 24 + insets.top, paddingHorizontal: 24, paddingBottom: 24 }}>
        <YStack space="$md" marginTop="$xl">
          <Text fontSize="$5" fontWeight="700" color="$textPrimary">
            录入资产
          </Text>
          <Text fontSize="$2" color="$textSecondary">
            查看者角色无法录入资产。请联系管理员升级为编辑者后再试。
          </Text>
          <Button size={44} fontSize={16} onPress={() => router.back()}>
            返回
          </Button>
        </YStack>
      </ScrollView>
    );
  }

  async function recognize() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('没有相机权限，请手动输入金额');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (shot.canceled) return;
    const uri = shot.assets[0]?.uri;
    if (!uri) return;

    setOcrLoading(true);
    try {
      const result = await getOcrEngine().recognize(uri);
      setCandidates(result.amountCandidates.slice(0, 5));
      if (result.amountCandidates.length === 0) {
        setError('没认出金额，请手动输入');
      }
    } catch {
      setError('端侧识别不可用，请手动输入金额');
      setCandidates([]);
    } finally {
      setOcrLoading(false);
    }
  }

  function applyCandidate(candidate: AmountCandidate) {
    setAmountText((candidate.valueInCents / 100).toFixed(2));
    setFromOcr(true);
    setCandidates([]);
  }

  async function save() {
    if (cents === null) {
      setError('金额格式不对');
      return;
    }
    if (name.trim() === '') {
      setError('给资产起个名字');
      return;
    }
    if (!familyId) {
      setError('尚未解锁密钥，无法录入');
      return;
    }
    const capturedAt = dateToNoonIso(date);
    setSaving(true);
    try {
      await addAsset({
        familyId,
        ownerId: user?.id ?? 'unknown',
        type,
        name: name.trim(),
        amountInCents: cents,
        source: fromOcr ? 'ocr' : 'manual',
        visibility,
        capturedAt,
      });
      router.back();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    // 页面容器用 RN 的 ScrollView（tamagui 的 ScrollView 在部分版本不导出），
    // 内层仍用 tamagui 的 YStack 保持间距/主题一致
    <ScrollView style={{ backgroundColor: '#F5F7FA' }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 32 }}>
      <YStack padding="$lg" space="$md">
        <Text fontSize="$5" fontWeight="700" color="$textPrimary">
          录入资产
        </Text>

        <YStack space="$xs">
          <Text fontSize="$2" color="$textSecondary">
            类型
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack space="$xs">
              {SELECTABLE_ASSET_TYPES.map((t) => (
                <Button
                  key={t}
                  size={36}
                  fontSize={14}
                  backgroundColor={t === type ? '$primary' : '$bgPrimary'}
                  color={t === type ? 'white' : '$textPrimary'}
                  onPress={() => {
                    setType(t);
                    if (!nameEdited) setName(ASSET_TYPE_LABELS[t]);
                  }}
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
            onChangeText={(t) => {
              setName(t);
              setNameEdited(t.trim() !== '');
            }}
            placeholder="如：招商银行活期"
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
            onChangeText={(t) => {
              setAmountText(t);
              setFromOcr(false);
            }}
            placeholder="0.00"
            keyboardType="decimal-pad"
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
          {cents !== null ? (
            <Text fontSize="$2" color="$textSecondary">
              = {formatCNY(cents)}
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
            默认今天，可修改为历史日期（补录）
          </Text>
        </YStack>

        <Button
          size={48}
          fontSize={16}
          backgroundColor="$bgPrimary"
          color="$primary"
          borderColor="$primary"
          borderWidth={1}
          disabled={ocrLoading}
          onPress={() => void recognize()}
        >
          {ocrLoading ? '识别中…' : '拍照识别金额'}
        </Button>

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

        {candidates.length > 0 ? (
          <YStack space="$xs">
            <Text fontSize="$2" color="$textSecondary">
              识别到 {candidates.length} 个候选，点一下填入
            </Text>
            {candidates.map((c, i) => (
              <Card
                key={`${c.raw}-${i}`}
                padded
                backgroundColor="$bgPrimary"
                borderColor="$border"
                borderWidth={1}
                borderRadius="$md"
                pressStyle={{ opacity: 0.6 }}
                onPress={() => applyCandidate(c)}
              >
                <XStack justifyContent="space-between" alignItems="center">
                  <Text fontSize="$4" fontWeight="600" color="$textPrimary">
                    {formatCNY(c.valueInCents)}
                  </Text>
                  <Text fontSize="$1" color="$textSecondary">
                    {c.keyword ?? (c.reason === 'currency-symbol' ? '带货币符号' : '纯数字')} ·{' '}
                    {Math.round(c.score * 100)}%
                  </Text>
                </XStack>
                <Text fontSize="$1" color="$textSecondary">
                  原文：{c.raw}
                </Text>
              </Card>
            ))}
          </YStack>
        ) : null}

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
          disabled={saving || cents === null}
          onPress={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
      </YStack>
    </ScrollView>
  );
}
