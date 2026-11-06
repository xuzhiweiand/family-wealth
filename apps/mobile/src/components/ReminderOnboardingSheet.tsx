/**
 * 首次引导弹窗：首笔资产保存成功后触发（P0-1）
 *
 * - 只在「用户已保存首笔快照」的激活时刻弹一次（AsyncStorage 标记）；
 * - 提供「开启提醒」（默认设置：每月最后一日 20:00，每 3 天重试）
 *   和「暂不」两个选项；
 * - 用户选择后写入 AsyncStorage，不再出现。
 */

import { COLORS } from '../theme';
import { FONT } from '../typography';
import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from '../lib/reminder-plan';
import { reminderService } from '../services/reminder-service';
import { reminderBackend } from '../services/reminder-backend';
import { markReminderOnboardingShown } from '../services/reminder-settings';

interface Props {
  visible: boolean;
  onClose: () => void; // 无论开启还是跳过，都调用此回调关闭
}

export function ReminderOnboardingSheet({ visible, onClose }: Props) {
  const handleEnable = async () => {
    // 1. 请求权限（Android 13+；鸿蒙在 T6 前返回 false → 走暂不开启分支）
    const granted = await reminderBackend.requestPermission();
    if (!granted) {
      // 权限被拒 → 暂不开启，但标记已展示
      await markReminderOnboardingShown();
      onClose();
      return;
    }
    // 2. 开启默认设置
    await reminderService.updateSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      enabled: true,
    });
    await markReminderOnboardingShown();
    onClose();
  };

  const handleSkip = async () => {
    await markReminderOnboardingShown();
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* 图标 */}
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>月</Text>
          </View>

          <Text style={styles.title}>开启月末盘点提醒？</Text>
          <Text style={styles.desc}>
            每月最后一日提醒你更新各账户余额，保持家庭资产台账完整。默认设置：最后一日 20:00，未完成时每 3 天再提醒一次（最晚追到次月 10 日）。
          </Text>

          {/* 选项 */}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void handleEnable()}>
            <Text style={styles.primaryText}>开启提醒</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handleSkip()}>
            <Text style={styles.secondaryText}>暂不</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 42, 31, 0.48)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.inkWash,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  icon: { fontSize: 26, fontFamily: FONT.serifCn, color: COLORS.goldDeep, fontWeight: '700' },
  title: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONT.serifCn,
    letterSpacing: 0.8,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  desc: {
    fontSize: 14,
    color: COLORS.sub,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryText: { fontSize: 16, fontWeight: '600', color: COLORS.surface },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryText: { fontSize: 16, color: COLORS.text },
});
