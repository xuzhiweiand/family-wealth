/**
 * 更新中心（v0.6.0）
 *
 * 底部 Tab 中间入口：一屏集中更新所有资产与债务。对照 v0.6.0 高保真单页
 * 「v0.6.0-update.html」复刻：页头 → 预估 hero → 筛选胶囊 → 分组输入卡
 * → 保存并同步。
 *
 * 业务逻辑不变：
 * - 每行默认展示「上期金额」（最新快照金额，无快照回落 currentAmount）；
 *   快照日期只用于「本月是否已更新」判断，不再单独展示
 * - 单条：行内输入金额后点行内的「保存」，立即写一条今天的新快照
 * - 底部「保存并同步」批量提交本页所有已填写且未保存的行
 * - 顶栏「＋ 录入」：新增资产（无资产/新增类别时必须走录入，更新页只能改已有资产）
 *
 * 金额变更统一走 asset-store.updateAmount（同时写快照，趋势图只认快照）。
 */

import { COLORS, SHADOW } from '../theme';
import { MONEY_TEXT, SERIF_CN_TEXT } from '../typography';
import { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { SELECTABLE_ASSET_TYPES } from '@family-wealth/shared-types';
import { canDoOnAsset, filterVisibleAssets } from '@family-wealth/family';
import { formatCNY } from '@family-wealth/shared-utils';
import { useAppNavigation } from '../lib/navigation';
import { useAssetStore } from '../stores/asset-store';
import { useAuthStore } from '../stores/auth-store';
import { useMyFamilyRole } from '../stores/family-store';
import { GradientCard } from '../components/GradientCard';
import { ASSET_TYPE_LABELS } from '../lib/asset-meta';
import {
  buildUpdateRows, groupUpdateRows, previewUpdateTotals,
  type UpdateGroup, type UpdateRow,
} from '../lib/update-center';
import { dateToNoonIso, parseYuanToCents, todayDate } from './AssetNewScreen';

type Filter = 'all' | 'asset' | 'debt';

/** 金额（分）→ '3,359,700'（不带 ¥） */
function amountText(cents: number): string {
  return formatCNY(cents, { fraction: false }).replace('¥', '');
}

/** 行内展示金额：债务按负数展示（与设计稿「上期 -1,460,000」一致） */
function rowAmountText(cents: number, negative: boolean): string {
  return negative ? `-${amountText(Math.abs(cents))}` : amountText(cents);
}

export default function UpdateCenterScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const heroWidth = screenWidth - 40;

  const user = useAuthStore((s) => s.user);
  const myRole = useMyFamilyRole();
  const assets = useAssetStore((s) => s.assets);
  const snapshots = useAssetStore((s) => s.snapshots);
  const updateAmount = useAssetStore((s) => s.updateAmount);

  const [filter, setFilter] = useState<Filter>('all');
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
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
  const assetGroups = useMemo(() => groups.filter((g) => g.type !== 'debt'), [groups]);
  const debtGroups = useMemo(() => groups.filter((g) => g.type === 'debt'), [groups]);

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

  // 当前净资产：全部沿用上期金额（不填任何新值）的口径
  const currentTotals = useMemo(() => previewUpdateTotals(rows, new Map<string, number>()), [rows]);

  const dirtyRows = useMemo(
    () => rows.filter((r) => canEditRow(r) && !savedIds[r.asset.id] && centsMap.has(r.asset.id)),
    // canEditRow 依赖 user/myRole，均已在上游依赖中
    [rows, savedIds, centsMap, user?.id, myRole],
  );

  const savedCount = rows.filter((r) => savedIds[r.asset.id] === true).length;

  // 已改：填了有效金额，且与上期不同或已在本页保存过（保存后仍保留标记）
  const changedCount = useMemo(
    () => rows.filter((r) => {
      const cents = centsMap.get(r.asset.id);
      return cents !== undefined && (savedIds[r.asset.id] === true || cents !== r.lastAmount);
    }).length,
    [rows, centsMap, savedIds],
  );

  // 待录入：本月还没有快照（含从未录入）的条目
  const pendingCount = useMemo(
    () => rows.filter((r) => r.lastDate === null || !r.updatedThisMonth).length,
    [rows],
  );

  const currentNetWorth = currentTotals.netWorth;
  const delta = preview.netWorth - currentNetWorth;
  const pct = currentNetWorth !== 0 ? (delta / Math.abs(currentNetWorth)) * 100 : null;
  const deltaText = `${delta >= 0 ? '+' : '-'}${amountText(Math.abs(delta))}`;
  const pctText = pct === null ? '—' : `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`;

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

  const saveAll = () => {
    if (dirtyRows.length > 0) {
      void saveRows(dirtyRows);
      return;
    }
    flash(savedCount > 0 ? '已保存并加密同步' : '请先填写金额');
  };

  const now = todayDate();
  const monthLabel = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  const empty = rows.length === 0;

  const renderCard = (cardGroups: readonly UpdateGroup[]) => (
    <View style={styles.card}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        {cardGroups.map((group, gi) => (
          <View key={group.type}>
            <Text fontSize={10} letterSpacing={2} color={COLORS.faint} paddingTop={14}>
              {group.label}
            </Text>
            {group.rows.map((row, ri) => {
              const editable = canEditRow(row);
              const saved = savedIds[row.asset.id] === true;
              const debt = row.asset.type === 'debt';
              const cents = centsMap.get(row.asset.id);
              const changed = !saved && cents !== undefined && cents !== row.lastAmount;
              const focused = focusedId === row.asset.id;
              const isLast = gi === cardGroups.length - 1 && ri === group.rows.length - 1;

              return (
                <XStack
                  key={row.asset.id}
                  alignItems="center"
                  space={12}
                  paddingVertical={13}
                  borderBottomWidth={isLast ? 0 : 1}
                  borderBottomColor={COLORS.divider}
                >
                  <YStack flex={1}>
                    <XStack alignItems="center" space={6}>
                      {changed ? <View style={styles.changeDot} /> : null}
                      <Text flex={1} fontSize={13} fontWeight="500" color={COLORS.text} numberOfLines={1}>
                        {row.asset.name}
                      </Text>
                    </XStack>
                    <XStack alignItems="center" space={6} marginTop={2} flexWrap="wrap">
                      <Text fontSize={10} color={COLORS.faint} style={MONEY_TEXT} numberOfLines={1}>
                        上期 {rowAmountText(row.lastAmount, debt)}
                      </Text>
                      {saved ? (
                        <Text fontSize={10} color={COLORS.inkSoft}>· 已更新</Text>
                      ) : null}
                      {!editable ? (
                        <Text fontSize={10} color={COLORS.danger}>· 只读</Text>
                      ) : null}
                      {changed ? (
                        <TouchableOpacity
                          onPress={() => { void saveRows([row]); }}
                          disabled={saving}
                          hitSlop={6}
                          accessibilityLabel={`保存${row.asset.name}`}
                        >
                          <Text fontSize={10} fontWeight="600" color={COLORS.inkSoft}>保存</Text>
                        </TouchableOpacity>
                      ) : null}
                    </XStack>
                  </YStack>
                  <TextInput
                    style={[
                      styles.rowInput,
                      MONEY_TEXT,
                      { color: debt ? COLORS.danger : COLORS.text },
                      focused ? styles.rowInputFocus : null,
                      saved ? styles.rowInputSaved : null,
                    ]}
                    value={values[row.asset.id] ?? ''}
                    onChangeText={(text) => setValues((prev) => ({ ...prev, [row.asset.id]: text }))}
                    placeholder={editable ? rowAmountText(row.lastAmount, debt) : '—'}
                    placeholderTextColor={COLORS.faint}
                    selectionColor={COLORS.gold}
                    keyboardType="decimal-pad"
                    editable={editable && !saved}
                    onFocus={() => setFocusedId(row.asset.id)}
                    onBlur={() => setFocusedId(null)}
                  />
                </XStack>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 页头 */}
        <XStack
          alignItems="flex-start"
          justifyContent="space-between"
          paddingHorizontal={24}
        >
          <YStack flex={1}>
            <Text fontSize={21} color={COLORS.text} letterSpacing={0.8} style={SERIF_CN_TEXT}>
              更新数据
            </Text>
            <Text fontSize={10.5} color={COLORS.faint} letterSpacing={1} marginTop={4}>
              {monthLabel} · 本地加密保存后同步
            </Text>
          </YStack>
          <TouchableOpacity
            onPress={() => navigation.navigate('AssetNew')}
            style={styles.entryBtn}
            accessibilityLabel="录入资产"
          >
            <Text fontSize={11} fontWeight="600" color={COLORS.goldDeep} letterSpacing={0.5}>
              ＋ 录入
            </Text>
          </TouchableOpacity>
        </XStack>

        {empty ? (
          /* 空状态：没有资产时，录入是唯一可行的下一步 */
          <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
            <YStack alignItems="center" backgroundColor={COLORS.surface} borderRadius={20}
              borderColor={COLORS.hairlineSoft} borderWidth={1} padding={24} style={SHADOW.card}>
              <YStack alignItems="center" justifyContent="center" width={80} height={80}
                borderRadius={24} backgroundColor={COLORS.inkWash} marginBottom={16}>
                <Svg width={40} height={40} viewBox="0 0 24 24" fill="none"
                  stroke={COLORS.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
                  <Path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
                  <Path d="M21 9h-5a2 2 0 1 0 0 4h5V9z" />
                  <Path d="M12 4v6M9 7h6" />
                </Svg>
              </YStack>
              <Text fontSize={16} color={COLORS.text} style={SERIF_CN_TEXT}>还没有任何资产</Text>
              <Text fontSize={12} color={COLORS.sub} textAlign="center" marginTop={8} lineHeight={20}>
                更新页只能给已有资产改余额。{'\n'}先录入一笔资产，之后就能在这里逐条更新。
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('AssetNew')}
                style={styles.emptyCta}
              >
                <Text fontSize={14} fontWeight="600" color={COLORS.paper} letterSpacing={1}>录入资产</Text>
              </TouchableOpacity>
              <YStack width="100%" backgroundColor={COLORS.paper} borderRadius={16} padding={10} marginTop={16}>
                <Text fontSize={10} fontWeight="600" color={COLORS.sub} marginBottom={6}>
                  支持录入的类别
                </Text>
                <XStack flexWrap="wrap" gap={6}>
                  {SELECTABLE_ASSET_TYPES.map((t) => (
                    <View key={t} style={styles.typeChip}>
                      <Text fontSize={10} color={t === 'debt' ? COLORS.danger : COLORS.sub}>
                        {ASSET_TYPE_LABELS[t]}
                      </Text>
                    </View>
                  ))}
                </XStack>
              </YStack>
              <Text fontSize={10} color={COLORS.faint} marginTop={8}>录入时名称、类别、金额为必填项</Text>
            </YStack>
          </View>
        ) : (
          <>
            {/* 预估 hero */}
            <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
              <GradientCard width={heroWidth} height={248} radius={26}>
                <YStack flex={1} paddingHorizontal={24} paddingTop={20} paddingBottom={20}
                  justifyContent="space-between">
                  <XStack alignItems="flex-start" justifyContent="space-between">
                    <YStack flex={1}>
                      <Text fontSize={10.5} letterSpacing={3} color="rgba(233,220,192,0.55)">
                        本次更新后净资产（预估）
                      </Text>
                      <Text fontSize={32} lineHeight={36} fontWeight="600" color={COLORS.paper}
                        marginTop={10} numberOfLines={1} style={MONEY_TEXT}>
                        ¥ {amountText(preview.netWorth)}
                      </Text>
                    </YStack>
                  </XStack>

                  <XStack alignItems="center" space={8}>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                      stroke={COLORS.gold} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <Path d="m22 7-8.5 8.5L8.5 10.5 2 17" />
                      <Path d="M16 7h6v6" />
                    </Svg>
                    <Text fontSize={12} color={COLORS.goldLight} style={MONEY_TEXT}>
                      较当前 {deltaText}
                    </Text>
                    <View style={styles.changedPill}>
                      <Text fontSize={10} color={COLORS.goldLight} style={MONEY_TEXT}>
                        已改 {changedCount} 项
                      </Text>
                    </View>
                  </XStack>

                  <YStack>
                    <View style={styles.hairlineGold} />
                    <XStack marginTop={16}>
                      <YStack flex={1} alignItems="center">
                        <Text fontSize={9.5} letterSpacing={2} color="rgba(233,220,192,0.45)">当前净资产</Text>
                        <Text fontSize={15.5} color="rgba(242,238,226,0.72)" marginTop={4} style={MONEY_TEXT}>
                          {amountText(currentNetWorth)}
                        </Text>
                      </YStack>
                      <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                        <Text fontSize={9.5} letterSpacing={2} color="rgba(233,220,192,0.45)">改动幅度</Text>
                        <Text fontSize={15.5} color={COLORS.goldLight} marginTop={4} style={MONEY_TEXT}>
                          {pctText}
                        </Text>
                      </YStack>
                      <YStack flex={1} alignItems="center" style={styles.heroColDivider}>
                        <Text fontSize={9.5} letterSpacing={2} color="rgba(233,220,192,0.45)">待录入</Text>
                        <Text fontSize={15.5} color={COLORS.inkWash} marginTop={4} style={MONEY_TEXT}>
                          {pendingCount} 项
                        </Text>
                      </YStack>
                    </XStack>
                  </YStack>
                </YStack>
              </GradientCard>
            </View>

            {/* 筛选 */}
            <XStack space={8} paddingHorizontal={24} marginTop={16}>
              {(['all', 'asset', 'debt'] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFilter(f)}
                  activeOpacity={0.75}
                  style={[styles.chip, filter === f ? styles.chipOn : null]}
                >
                  <Text fontSize={12} fontWeight="600" color={filter === f ? COLORS.paper : COLORS.sub}>
                    {f === 'all' ? '全部' : f === 'asset' ? '资产' : '负债'}
                  </Text>
                </TouchableOpacity>
              ))}
            </XStack>

            {/* 分组输入卡 */}
            {filter !== 'debt' && assetGroups.length > 0 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
                {renderCard(assetGroups)}
              </View>
            ) : null}
            {filter !== 'asset' && debtGroups.length > 0 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
                {renderCard(debtGroups)}
              </View>
            ) : null}
            {groups.length === 0 ? (
              <YStack alignItems="center" paddingVertical={32}>
                <Text fontSize={12} color={COLORS.faint}>该分类下暂无资产</Text>
              </YStack>
            ) : null}

            {/* 保存 */}
            <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
              <TouchableOpacity
                onPress={saveAll}
                disabled={saving}
                activeOpacity={0.9}
                style={[styles.saveAll, saving ? styles.saveAllBusy : null]}
                accessibilityLabel="保存并同步"
              >
                <Text fontSize={14} fontWeight="600" color={COLORS.paper} letterSpacing={3}>
                  保存并同步
                </Text>
              </TouchableOpacity>
              <Text fontSize={10} color={COLORS.faint} textAlign="center" marginTop={12} lineHeight={16}>
                数据在本机加密后才上传，服务端无法读取明文
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* 轻提示 */}
      {toast !== null ? (
        <View style={[styles.toast, { bottom: insets.bottom + 24 }]}>
          <Text fontSize={12} fontWeight="500" color={COLORS.paper}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(198,161,91,0.35)',
    backgroundColor: 'rgba(198,161,91,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  changedPill: {
    backgroundColor: 'rgba(198,161,91,0.18)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hairlineGold: {
    height: 1,
    backgroundColor: 'rgba(198,161,91,0.30)',
  },
  heroColDivider: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(233,220,192,0.14)',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  chipOn: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    ...SHADOW.card,
  },
  changeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.gold,
  },
  rowInput: {
    width: 118,
    height: 36,
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surfaceWarm,
    textAlign: 'right',
    textAlignVertical: 'center',
    fontSize: 13,
  },
  rowInputFocus: {
    borderColor: COLORS.gold,
    backgroundColor: COLORS.surface,
  },
  rowInputSaved: {
    backgroundColor: COLORS.inkWash,
    borderColor: COLORS.mintLine,
  },
  saveAll: {
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.ink,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  saveAllBusy: { opacity: 0.7 },
  emptyCta: {
    height: 44,
    width: '100%',
    borderRadius: 16,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(11,61,46,0.94)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: COLORS.inkDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
});
