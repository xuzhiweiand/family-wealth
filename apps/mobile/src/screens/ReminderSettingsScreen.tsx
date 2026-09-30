/**
 * 盘点提醒设置页（P0-1）
 *
 * - 开关 / 提醒日 / 提醒时间 / 重试频率 均为预设档位（点击选中），
 *   避开时间选择器的平台差异；
 * - 展示通知权限状态，被拒时引导去系统设置开启；
 * - 底部展示「下次提醒」预览（来自 ReminderService 当前计划）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppNavigation } from '../lib/navigation';
import {
  DEFAULT_REMINDER_SETTINGS,
  buildReminderPlan,
  type ReminderDay,
  type ReminderSettings,
} from '../lib/reminder-plan';
import { reminderService } from '../services/reminder-service';
import { reminderBackend } from '../services/reminder-backend';

const DAY_OPTIONS: { label: string; value: ReminderDay }[] = [
  { label: '每月最后一日', value: 'last' },
  { label: '每月 1 日', value: 1 },
  { label: '每月 5 日', value: 5 },
  { label: '每月 10 日', value: 10 },
  { label: '每月 15 日', value: 15 },
  { label: '每月 20 日', value: 20 },
  { label: '每月 25 日', value: 25 },
  { label: '每月 28 日', value: 28 },
];

const TIME_OPTIONS: { label: string; hour: number; minute: number }[] = [
  { label: '08:00', hour: 8, minute: 0 },
  { label: '12:00', hour: 12, minute: 0 },
  { label: '20:00', hour: 20, minute: 0 },
  { label: '21:00', hour: 21, minute: 0 },
  { label: '22:00', hour: 22, minute: 0 },
];

const RETRY_OPTIONS: { label: string; value: number }[] = [
  { label: '每天', value: 1 },
  { label: '每 2 天', value: 2 },
  { label: '每 3 天', value: 3 },
  { label: '每 5 天', value: 5 },
  { label: '每 7 天', value: 7 },
];

function formatNext(s: ReminderSettings): string {
  const plan = buildReminderPlan(s, new Date(), 1);
  const first = plan[0];
  if (!s.enabled || !first) return '—';
  const d = first.fireAt;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}${first.kind === 'retry' ? '（补提醒）' : ''}`;
}

export default function ReminderSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');

  useEffect(() => {
    void (async () => {
      await reminderService.init();
      setSettings(reminderService.getSettings() ?? DEFAULT_REMINDER_SETTINGS);
      setPermission(await reminderBackend.getPermissionStatus());
    })();
  }, []);

  const update = useCallback((patch: Partial<ReminderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void reminderService.updateSettings(next);
      return next;
    });
  }, []);

  const toggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        // 开启时先确保通知权限
        const granted = await reminderBackend.requestPermission();
        setPermission(await reminderBackend.getPermissionStatus());
        if (!granted) return; // 未授权不打开开关
      }
      update({ enabled });
    },
    [update],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 顶部返回 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>盘点提醒</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 权限提示 */}
        {permission === 'denied' ? (
          <TouchableOpacity
            style={styles.permBanner}
            onPress={() => void reminderBackend.openSystemSettings()}
          >
            <Text style={styles.permText}>
              通知权限未开启，提醒无法送达。点此去系统设置开启 ›
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* 开关 */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>月末盘点提醒</Text>
              <Text style={styles.rowDesc}>到点提醒你给各账户记一笔余额</Text>
            </View>
            <Switch value={settings.enabled} onValueChange={(v) => void toggleEnabled(v)} />
          </View>
        </View>

        {settings.enabled ? (
          <>
            {/* 提醒日 */}
            <Text style={styles.sectionLabel}>提醒日</Text>
            <View style={styles.card}>
              <View style={styles.chipsWrap}>
                {DAY_OPTIONS.map((o) => (
                  <Chip
                    key={String(o.value)}
                    label={o.label}
                    active={settings.dayOfMonth === o.value}
                    onPress={() => update({ dayOfMonth: o.value })}
                  />
                ))}
              </View>
            </View>

            {/* 提醒时间 */}
            <Text style={styles.sectionLabel}>提醒时间</Text>
            <View style={styles.card}>
              <View style={styles.chipsWrap}>
                {TIME_OPTIONS.map((o) => (
                  <Chip
                    key={o.label}
                    label={o.label}
                    active={settings.hour === o.hour && settings.minute === o.minute}
                    onPress={() => update({ hour: o.hour, minute: o.minute })}
                  />
                ))}
              </View>
            </View>

            {/* 重试频率 */}
            <Text style={styles.sectionLabel}>未完成时重复提醒</Text>
            <View style={styles.card}>
              <View style={styles.chipsWrap}>
                {RETRY_OPTIONS.map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    active={settings.retryIntervalDays === o.value}
                    onPress={() => update({ retryIntervalDays: o.value })}
                  />
                ))}
              </View>
              <Text style={styles.footnote}>最晚持续到次月 10 日；当月完成盘点后自动停止</Text>
            </View>

            {/* 下次提醒预览 */}
            <View style={styles.nextBox}>
              <Text style={styles.nextText}>下次提醒：{formatNext(settings)}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backText: { fontSize: 30, color: '#111827', marginTop: -4 },
  title: { fontSize: 17, fontWeight: '600', color: '#111827' },
  body: { padding: 16, paddingBottom: 40 },
  permBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  permText: { fontSize: 13, color: '#92400E', lineHeight: 18 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  rowDesc: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  sectionLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#10B981' },
  chipText: { fontSize: 14, color: '#374151' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  footnote: { fontSize: 12, color: '#9CA3AF', marginTop: 10, lineHeight: 17 },
  nextBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
  },
  nextText: { fontSize: 13, color: '#059669', textAlign: 'center' },
});
