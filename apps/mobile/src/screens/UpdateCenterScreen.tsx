/**
 * 更新中心（v0.3.1）
 *
 * 底部 Tab 中间入口：一屏集中更新所有资产与债务。
 * - 每行默认展示「上次数据」（最新快照金额 + 记账日期），无快照回落 currentAmount
 * - 单条：行内输入金额后点「保存」，立即写一条今天的新快照
 * - 顶栏「＋ 录入」：新增资产（无资产/新增类别时必须走录入，更新页只能改已有资产）
 *
 * 金额变更统一走 asset-store.updateAmount（同时写快照，趋势图只认快照）。
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Input, Text, XStack, YStack } from 'tamagui';
import { SELECTABLE_ASSET_TYPES } from '@family-wealth/shared-types';
import { canDoOnAsset, filterVisibleAssets } from '@family-wealth/family';
import { formatCNY, formatCNYCompact } from '@family-wealth/shared-utils';
import { useAppNavigation } from '../lib/navigation';
import { useAssetStore } from '../stores/asset-store';
import { useAuthStore } from '../stores/auth-store';
import { useMyFamilyRole } from '../stores/family-store';
import { GradientCard } from '../components/GradientCard';
import { ASSET_TYPE_LABELS } from '../lib/asset-meta';
import { buildUpdateRows, groupUpdateRows, previewUpdateTotals, type UpdateRow } from '../lib/update-center';
import { dateToNoonIso, parseYuanToCents, todayDate } from './AssetNewScreen';

const GROWTH_UP = '#059669';
const GROWTH_DOWN = '#DC2626';

type Filter = 'all' | 'asset' | 'debt';

export default function UpdateCenterScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // 直板机（<600pt）行内放不下三段，改三层纵向布局，避免提示文案与输入框重叠
  const compact = screenWidth < 600;

  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const updateAmount = useAssetStore((s) => s.updateAmount);

  const [filter, setFilter] = useState<Filter>('all');
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 可见口径：软删过滤 + 私有资产对非所有者不可见
  const visibleAssets = useMemo(
    () => filterVisibleAssets(assets.filter((a) => a.deletedAt === null), user?.id ?? '', myRole),
    [assets, user?.id, myRole],
  );

  const rows = useMemo(() => buildUpdateRows(visibleAssets, snapshots), [visibleAssets, snapshots]);

  const canEditRow = (row: UpdateRow) =>
    canDoOnAsset(
      { role: myRole, visibility: row.asset.visibility, isOwn: row.asset.ownerId === (user?.id ?? '') },
      'edit',
    );

  const visibleRows = useMemo(() => {
    if (filter === 'asset') return rows.filter((r) => r.asset.type !== 'debt');
    if (filter === 'debt') return rows.filter((r) => r.asset.type === 'debt');
    return rows;
  }, [rows, filter]);

  const groups = useMemo(() => groupUpdateRows(visibleRows), [visibleRows]);

  // 已填金额（分）→ 预览与保存共用
  const centsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const text = values[row.asset.id];
      if (text === undefined || text.trim() === '') continue;
      const cents = parseYuanToCents(text);
      if (cents !== null) map.set(row.asset.id, cents);
    }
    return map;
  }, [rows, values]);

  const preview = useMemo(() => previewUpdateTotals(rows, centsMap), [rows, centsMap]);

  const dirtyRows = useMemo(
    () => rows.filter((r) => canEditRow(r) && !savedIds[r.asset.id] && centsMap.has(r.asset.id)),
    // canEditRow 依赖 user/myRole，均已在上游依赖中
    [rows, savedIds, centsMap, user?.id, myRole],
  );

  const savedCount = rows.filter((r) => savedIds[r.asset.id] === true).length;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const saveRows = async (list: readonly UpdateRow[]) => {
    if (saving) return;
    if (list.length === 0) {
      flash('请先填写金额');
      return;
    }
    setSaving(true);
    let ok = 0;
    try {
      for (const row of list) {
        const cents = centsMap.get(row.asset.id);
        if (cents === undefined) continue;
        await updateAmount(row.asset.id, cents, row.asset.familyId, 'manual', dateToNoonIso(todayDate()));
        setSavedIds((prev) => ({ ...prev, [row.asset.id]: true }));
        ok += 1;
      }
      flash(ok === 1 ? '已更新 1 项' : `已更新 ${ok} 项`);
    } catch (err) {
      flash(`更新失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const empty = rows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F7FA' }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 顶栏：返回 + 标题 + 录入 */}
        <XStack alignItems="center" justifyContent="space-between" marginBottom="$md">
          <XStack alignItems="center" space="$sm">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              accessibilityLabel="返回"
            >
              <Text fontSize={18} color="$textPrimary">‹</Text>
            </TouchableOpacity>
            <YStack>
              <Text fontSize="$5" fontWeight="700" color="$textPrimary">更新数据</Text>
              <Text fontSize="$1" color="$textTertiary">
                {todayDate().toISOString().slice(0, 10)} · 共 {rows.length} 项
              </Text>
            </YStack>
          </XStack>
          <TouchableOpacity
            onPress={() => navigation.navigate('AssetNew')}
            style={styles.entryBtn}
            accessibilityLabel="录入资产"
          >
            <Text fontSize="$1" fontWeight="700" color="white">＋ 录入</Text>
          </TouchableOpacity>
        </XStack>

        {empty ? (
          /* 空状态：没有资产时，录入是唯一可行的下一步 */
          <YStack alignItems="center" backgroundColor="white" borderRadius="$lg"
            borderColor="$border" borderWidth={1} padding="$lg" marginTop="$lg">
            <YStack alignItems="center" justifyContent="center" width={80} height={80}
              borderRadius={24} backgroundColor="#ECFDF5" marginBottom="$md">
              <Svg width={40} height={40} viewBox="0 0 24 24" fill="none"
                stroke="#10B981" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
                <Path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
                <Path d="M21 9h-5a2 2 0 1 0 0 4h5V9z" />
                <Path d="M12 4v6M9 7h6" />
              </Svg>
            </YStack>
            <Text fontSize="$4" fontWeight="700" color="$textPrimary">还没有任何资产</Text>
            <Text fontSize="$2" color="$textSecondary" textAlign="center" marginTop="$sm" lineHeight={20}>
              更新页只能给已有资产改余额。{'\n'}先录入一笔资产，之后就能在这里逐条更新。
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('AssetNew')}
              style={styles.emptyCta}
            >
              <Text fontSize="$3" fontWeight="700" color="white">录入资产</Text>
            </TouchableOpacity>
            <YStack width="100%" backgroundColor="#F9FAFB" borderRadius={16} padding="$sm" marginTop="$md">
              <Text fontSize="$1" fontWeight="600" color="$textSecondary" marginBottom="$xs">
                支持录入的类别
              </Text>
              <XStack flexWrap="wrap" gap={6}>
                {SELECTABLE_ASSET_TYPES.map((t) => (
                  <View key={t} style={styles.typeChip}>
                    <Text fontSize={10} color={t === 'debt' ? GROWTH_DOWN : '#4B5563'}>
                      {ASSET_TYPE_LABELS[t]}
                    </Text>
                  </View>
                ))}
              </XStack>
            </YStack>
            <Text fontSize="$1" color="$textTertiary" marginTop="$sm">录入时名称、类别、金额为必填项</Text>
          </YStack>
        ) : (
          <>
            {/* 汇总预览 */}
            <XStack marginBottom="$md">
              <GradientCard width={screenWidth - 32} height={172} radius={22}>
                <YStack flex={1} padding="$md" justifyContent="space-between">
                  <XStack justifyContent="space-between">
                    <YStack>
                      <Text fontSize="$1" color="white" opacity={0.85}>更新后净资产预览</Text>
                      <Text fontSize={26} fontWeight="700" color="white" marginTop="$xs">
                        {formatCNY(preview.netWorth)}
                      </Text>
                    </YStack>
                    <YStack alignItems="flex-end">
                      <Text fontSize="$1" color="white" opacity={0.85}>已更新</Text>
                      <Text fontSize="$4" fontWeight="700" color="white" marginTop="$xs">
                        {savedCount} / {rows.length}
                      </Text>
                    </YStack>
                  </XStack>
                  <XStack space="$sm">
                    <View style={styles.subBox}>
                      <Text fontSize="$1" color="white" opacity={0.8}>资产合计</Text>
                      <Text fontSize="$2" fontWeight="600" color="white">
                        {formatCNYCompact(preview.totalAssets)}
                      </Text>
                    </View>
                    <View style={styles.subBox}>
                      <Text fontSize="$1" color="white" opacity={0.8}>负债合计</Text>
                      <Text fontSize="$2" fontWeight="600" color="white">
                        {formatCNYCompact(preview.totalLiabilities)}
                      </Text>
                    </View>
                    <View style={styles.subBox}>
                      <Text fontSize="$1" color="white" opacity={0.8}>已填未存</Text>
                      <Text fontSize="$2" fontWeight="600" color="white">{dirtyRows.length} 项</Text>
                    </View>
                  </XStack>
                </YStack>
              </GradientCard>
            </XStack>

            {/* 筛选 */}
            <XStack space="$sm" alignItems="center" marginBottom="$md">
              {(['all', 'asset', 'debt'] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[styles.chip, filter === f ? styles.chipOn : null]}
                >
                  <Text fontSize="$2" fontWeight="600" color={filter === f ? 'white' : '$textSecondary'}>
                    {f === 'all' ? '全部' : f === 'asset' ? '资产' : '负债'}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text fontSize="$1" color="$textTertiary" marginLeft="auto">
                输入金额后点「保存」
              </Text>
            </XStack>

            {/* 列表：按类型分组 */}
            {groups.length === 0 ? (
              <YStack alignItems="center" paddingVertical="$2xl">
                <Text fontSize="$2" color="$textTertiary">该分类下暂无资产</Text>
              </YStack>
            ) : (
              groups.map((group) => (
                <YStack key={group.type} marginBottom="$sm">
                  <XStack alignItems="center" space="$sm" paddingHorizontal="$xs" marginBottom="$xs">
                    <View style={[styles.typeDot, { backgroundColor: group.color }]} />
                    <Text fontSize="$1" fontWeight="700" color="$textSecondary">{group.label}</Text>
                    <Text fontSize="$1" color="$textTertiary">{group.rows.length} 项</Text>
                  </XStack>
                  <YStack backgroundColor="white" borderRadius="$md" overflow="hidden"
                    borderColor="$border" borderWidth={1}>
                    {group.rows.map((row, idx) => {
                      const editable = canEditRow(row);
                      const saved = savedIds[row.asset.id] === true;
                      return (
                        <YStack
                          key={row.asset.id}
                          paddingHorizontal="$sm"
                          paddingVertical="$sm"
                          backgroundColor={saved ? '#F0FDF4' : 'white'}
                          borderTopWidth={idx === 0 ? 0 : 1}
                          borderTopColor="$border"
                        >
                          {(() => {
                            const saveBtn = (
                              <TouchableOpacity
                                onPress={() => { void saveRows([row]); }}
                                disabled={saved || !editable || saving}
                                style={[
                                  styles.saveBtn,
                                  saved
                                    ? styles.saveBtnDone
                                    : editable && centsMap.has(row.asset.id)
                                      ? styles.saveBtnOn
                                      : styles.saveBtnOff,
                                ]}
                              >
                                <Text
                                  fontSize="$1"
                                  fontWeight="700"
                                  color={saved ? GROWTH_UP : editable && centsMap.has(row.asset.id) ? 'white' : '$textTertiary'}
                                >
                                  {saved ? '已更新' : '保存'}
                                </Text>
                              </TouchableOpacity>
                            );
                            const nameMeta = (
                              <YStack flex={1}>
                                <Text fontSize="$3" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                                  {row.asset.name}
                                </Text>
                                <XStack space="$xs" alignItems="center" flexWrap="wrap">
                                  <Text fontSize="$1" color="$textTertiary">
                                    上次 {formatCNY(row.lastAmount)}
                                  </Text>
                                  <Text fontSize="$1" color="$textTertiary">
                                    · {row.lastDate === null ? '未记录' : row.lastDate.slice(5)}
                                  </Text>
                                  {row.updatedThisMonth ? (
                                    <Text fontSize="$1" color={GROWTH_UP}>· 本月已更新</Text>
                                  ) : null}
                                  {!editable ? (
                                    <Text fontSize="$1" color={GROWTH_DOWN}>· 只读</Text>
                                  ) : null}
                                </XStack>
                              </YStack>
                            );
                            // 胶囊紧凑输入：圆边外壳 + ¥ 前缀 + 透明背景右对齐 Input
                            const amountInput = (
                              <View
                                style={[
                                  styles.pillWrap,
                                  saved ? styles.pillDone : null,
                                ]}
                              >
                                <Text fontSize="$1" color="$textTertiary" marginRight={2}>¥</Text>
                                <Input
                                  flex={1}
                                  height={26}
                                  fontSize={12}
                                  paddingHorizontal={0}
                                  paddingVertical={0}
                                  textAlign="right"
                                  value={values[row.asset.id] ?? ''}
                                  onChangeText={(text) => setValues((prev) => ({ ...prev, [row.asset.id]: text }))}
                                  placeholder={editable ? '最新值' : '—'}
                                  placeholderTextColor="$textTertiary"
                                  keyboardType="decimal-pad"
                                  editable={editable && !saved}
                                  backgroundColor="transparent"
                                  borderWidth={0}
                                />
                              </View>
                            );
                            const nameLine = (
                              <Text fontSize="$3" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                                {row.asset.name}
                              </Text>
                            );
                            const metaLine = (
                              <XStack space="$xs" alignItems="center" flexWrap="wrap">
                                <Text fontSize="$1" color="$textTertiary">
                                  上次 {formatCNY(row.lastAmount)}
                                </Text>
                                <Text fontSize="$1" color="$textTertiary">
                                  · {row.lastDate === null ? '未记录' : row.lastDate.slice(5)}
                                </Text>
                                {row.updatedThisMonth ? (
                                  <Text fontSize="$1" color={GROWTH_UP}>· 本月已更新</Text>
                                ) : null}
                                {!editable ? (
                                  <Text fontSize="$1" color={GROWTH_DOWN}>· 只读</Text>
                                ) : null}
                                {saved ? (
                                  <Text fontSize="$1" color={GROWTH_UP}>· 已更新</Text>
                                ) : null}
                              </XStack>
                            );
                            return compact ? (
                              // 直板机：名称 + 胶囊 + 保存 一行；元信息单独一行在下方
                              <YStack space="$1">
                                <XStack alignItems="center" space="$sm">
                                  <YStack flex={1}>{nameLine}</YStack>
                                  {amountInput}
                                  {saveBtn}
                                </XStack>
                                {metaLine}
                              </YStack>
                            ) : (
                              // 折叠机：单行三段
                              <XStack alignItems="center" space="$sm">
                                <YStack flex={1}>
                                  {nameLine}
                                  {metaLine}
                                </YStack>
                                {amountInput}
                                {saveBtn}
                              </XStack>
                            );
                          })()}
                        </YStack>
                      );
                    })}
                  </YStack>
                </YStack>
              ))
            )}

            <Text fontSize="$1" color="$textTertiary" textAlign="center" marginTop="$xs">
              没找到要更新的资产？点右上角「＋ 录入」新增
            </Text>
          </>
        )}
      </ScrollView>

      {/* 轻提示 */}
      {toast !== null ? (
        <View style={[styles.toast, { bottom: insets.bottom + 24 }]}>
          <Text fontSize="$2" fontWeight="600" color="white">{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  entryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCta: {
    height: 44,
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  subBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipOn: { backgroundColor: '#111827', borderColor: '#111827' },
  typeDot: { width: 7, height: 7, borderRadius: 4 },
  saveBtn: {
    minWidth: 46,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  saveBtnOn: { backgroundColor: '#10B981' },
  saveBtnDone: { backgroundColor: '#ECFDF5' },
  saveBtnOff: { backgroundColor: '#F3F4F6' },
  pillWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minWidth: 100,
  },
  pillDone: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(17,24,39,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
