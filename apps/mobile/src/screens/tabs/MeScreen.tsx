/**
 * 我的
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-profile.html」复刻：
 *   账号头 → 账号 / 安全与隐私 / 功能 / 关于 分组卡片 → 退出登录
 *
 * 保留原有业务：绑定手机号弹层、注销账号、当前家庭跳转、端到端加密状态、
 * 生物识别 / 异动提醒 / 金额默认隐藏本机偏好、盘点提醒 / 报表 / 本地备份 /
 * 导出报表 / 帮助反馈、退出登录。
 *
 * 安全开关是本机偏好；端到端加密由架构保证、恒为开启。
 */

import { COLORS, SHADOW } from '../../theme';
import { SERIF_CN_TEXT } from '../../typography';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, ScrollView, TouchableOpacity, View,
} from 'react-native';
import { useAppNavigation } from '../../lib/navigation';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';
import { ROLE_LABELS, filterVisibleAssets } from '@family-wealth/family';
import { useAuthStore } from '../../stores/auth-store';
import { useAssetStore } from '../../stores/asset-store';
import { useFamilyStore, useMyFamilyRole } from '../../stores/family-store';
import { OfflineBanner } from '../../components/OfflineBanner';
import { PhoneBindingSheet } from '../../components/PhoneBindingSheet';
import { exportAssetsCsv } from '../../services/export';
import { getPhone } from '../../services/secure-storage';
import { maskPhone } from '../../services/phone';

type IconGlyph = React.ReactNode;

/** 设计稿的 rgba 叠加色（图标芯片 / 退出登录按钮），不写死十六进制 */
const CHIP_INK = 'rgba(11,61,46,0.08)';
const CHIP_GOLD = 'rgba(198,161,91,0.14)';
const CHIP_RED = 'rgba(180,69,60,0.09)';
const SIGN_OUT_BG = 'rgba(180,69,60,0.07)';
const SIGN_OUT_LINE = 'rgba(180,69,60,0.18)';

const LOCK: IconGlyph = (
  <>
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <Path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
  </>
);
const EYE: IconGlyph = (
  <>
    <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <Circle cx="12" cy="12" r="3" />
  </>
);
const FINGERPRINT: IconGlyph = (
  <Path d="M12 11a2 2 0 0 0-2 2c0 1.5.5 3 .5 4.5M8.5 8.5a5 5 0 0 1 8.2 3.8c0 1.4-.2 2.7-.6 4M5 12a7 7 0 0 1 .6-2.9M5.8 16c.5 1 .7 2 .7 3M12 7.5A8.5 8.5 0 0 0 4 14c0 1 .1 2 .3 3M19 13c0 3-.5 5-2 7" />
);
const BACKUP: IconGlyph = (
  <>
    <Path d="M21 12a9 9 0 1 1-3-6.7" />
    <Path d="M21 3v5h-5" />
  </>
);
const SYNC: IconGlyph = (
  <>
    <Path d="M21 12a9 9 0 1 1-9-9" />
    <Path d="M21 3v6h-6" />
  </>
);
const BELL: IconGlyph = (
  <>
    <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <Path d="M10 20a2 2 0 0 0 4 0" />
  </>
);
const CALENDAR: IconGlyph = (
  <>
    <Path d="M8 2v4M16 2v4" />
    <Path d="M3 8h18" />
    <Path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
  </>
);
const CHART: IconGlyph = (
  <>
    <Path d="M3 3v18h18" />
    <Path d="M8 17V9M13 17V5M18 17v-7" />
  </>
);
const DOWNLOAD: IconGlyph = (
  <>
    <Path d="M12 3v12" />
    <Path d="m7 11 5 5 5-5" />
    <Path d="M5 21h14" />
  </>
);
const HELP: IconGlyph = (
  <>
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </>
);
const INFO: IconGlyph = (
  <>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 16v-4M12 8h.01" />
  </>
);
const HOME: IconGlyph = (
  <>
    <Path d="m3 11 9-8 9 8" />
    <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
  </>
);
const PHONE: IconGlyph = (
  <>
    <Path d="M7 2h10a2.5 2.5 0 0 1 2.5 2.5v15A2.5 2.5 0 0 1 17 22H7a2.5 2.5 0 0 1-2.5-2.5v-15A2.5 2.5 0 0 1 7 2Z" />
    <Path d="M11 18.5h2" />
  </>
);
const TRASH: IconGlyph = (
  <>
    <Path d="M3 6h18" />
    <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>
);

export default function MeScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const assets = useAssetStore((s) => s.assets);

  const family = useFamilyStore((s) => s.family);
  const refresh = useFamilyStore((s) => s.refresh);
  const role = useMyFamilyRole();

  // 本机偏好开关（金额默认隐藏沿用设计稿默认开启）
  const [hideAmounts, setHideAmounts] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [notify, setNotify] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneSheet, setPhoneSheet] = useState(false);

  useEffect(() => {
    refresh();
    void getPhone().then(setPhone);
  }, [refresh]);

  // 导出遵循可见性口径（P0-3 验收 2）：与资产列表同一份 filterVisibleAssets，
  // 他人的私有资产不会进入导出文件
  const exportableAssets = useMemo(
    () =>
      filterVisibleAssets(
        assets.filter((a) => a.deletedAt === null),
        user?.id ?? '',
        role,
      ),
    [assets, user?.id, role],
  );

  const version = '0.6.0';

  const handleExport = async () => {
    if (exporting) return;
    if (exportableAssets.length === 0) {
      Alert.alert('暂无数据', '还没有可导出的资产，先录入几笔吧');
      return;
    }
    setExporting(true);
    try {
      const result = await exportAssetsCsv(exportableAssets);
      // shared：系统面板已表达；cancelled：用户主动取消，静默即可
      if (result.status === 'saved') {
        Alert.alert('导出成功', '报表已保存到你选择的位置');
      }
    } catch (err) {
      Alert.alert('导出失败', (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('退出登录', '确定退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          const { reminderService } = await import('../../services/reminder-service');
          await reminderService.onLogout();
          await signOut();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      '注销账号',
      '注销后将永久删除该账号及其云端数据（家庭、成员、同步记录），且无法恢复。\n\n若你用华为账号登录后想改为绑定已有邮箱账号，注销后重新用华为账号登录，在过渡页选择「绑定已有邮箱账号」即可。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续注销',
          style: 'destructive',
          onPress: () => confirmDeleteAccount(),
        },
      ],
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert('确认注销', '此操作不可撤销，确定要注销当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认注销',
        style: 'destructive',
        onPress: async () => {
          const { reminderService } = await import('../../services/reminder-service');
          await reminderService.onLogout();
          const ok = await deleteAccount();
          if (!ok) {
            Alert.alert('注销失败', useAuthStore.getState().error ?? '请稍后重试');
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <View style={{ height: insets.top, backgroundColor: COLORS.paper }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 账号头：宋体姓名 + 加密徽标（头像按 v0.6.0 定稿移除印章） */}
        <XStack alignItems="center" space={16} paddingTop={8}>
          <YStack flex={1}>
            <Text fontSize={18} color={COLORS.text} numberOfLines={1} style={SERIF_CN_TEXT}>
              {user?.displayName ?? '未登录'}
            </Text>
            <Text fontSize={11} color={COLORS.faint} marginTop={2} numberOfLines={1}>
              {user?.email ?? '—'}
            </Text>
          </YStack>
          <XStack alignItems="center" space={5}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.gold }} />
            <Text fontSize={11} color={COLORS.ink}>已开启加密</Text>
          </XStack>
        </XStack>

        {/* 账号 */}
        <SectionLabel>账号</SectionLabel>
        <Group>
          <Row
            glyph={PHONE} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="绑定手机号"
            value={phone ? maskPhone(phone) : '去绑定'}
            {...(phone ? {} : { valueColor: COLORS.inkSoft })}
            chevron
            onPress={() => setPhoneSheet(true)}
          />
          <Row
            glyph={HOME} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="当前家庭"
            value={family ? `${family.name} · ${ROLE_LABELS[role]}` : '尚未加入家庭'}
            chevron
            onPress={() => navigation.navigate('Family')}
          />
          <Row
            glyph={TRASH} glyphColor={COLORS.danger} glyphBg={CHIP_RED}
            label="注销账号"
            chevron
            isLast
            onPress={handleDeleteAccount}
          />
        </Group>

        {/* 安全与隐私 */}
        <SectionLabel>安全与隐私</SectionLabel>
        <Group>
          <Row
            glyph={LOCK} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="端到端加密"
            value="已开启"
            valueColor={COLORS.inkSoft}
          />
          <Row
            glyph={EYE} glyphColor={COLORS.goldDeep} glyphBg={CHIP_GOLD}
            label="金额默认隐藏"
            toggle
            toggleValue={hideAmounts}
            onToggle={setHideAmounts}
          />
          <Row
            glyph={FINGERPRINT} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="生物识别解锁"
            toggle
            toggleValue={biometric}
            onToggle={setBiometric}
          />
          <Row
            glyph={BACKUP} glyphColor={COLORS.goldDeep} glyphBg={CHIP_GOLD}
            label="本地备份"
            chevron
            isLast
            onPress={() => navigation.navigate('Backup')}
          />
        </Group>

        {/* 功能 */}
        <SectionLabel>功能</SectionLabel>
        <Group>
          <Row
            glyph={SYNC} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="数据同步"
            value="刚刚"
          />
          <Row
            glyph={HELP} glyphColor={COLORS.goldDeep} glyphBg={CHIP_GOLD}
            label="帮助与反馈"
            chevron
            onPress={() => navigation.navigate('HelpFeedback')}
          />
          <Row
            glyph={CALENDAR} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="盘点提醒"
            chevron
            onPress={() => navigation.navigate('ReminderSettings')}
          />
          <Row
            glyph={CHART} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="月度/年度报表"
            chevron
            onPress={() => navigation.navigate('Report')}
          />
          <Row
            glyph={BELL} glyphColor={COLORS.warning} glyphBg={CHIP_GOLD}
            label="异动提醒"
            toggle
            toggleValue={notify}
            onToggle={setNotify}
          />
          {/* P0-3：全平台导出（Android 系统分享 / 鸿蒙系统另存为）；空数据置灰 */}
          <Row
            glyph={DOWNLOAD} glyphColor={COLORS.goldDeep} glyphBg={CHIP_GOLD}
            label={exporting ? '正在导出…' : '导出报表'}
            chevron
            dimmed={exportableAssets.length === 0}
            isLast
            onPress={handleExport}
          />
        </Group>

        {/* 关于 */}
        <SectionLabel>关于</SectionLabel>
        <Group>
          <Row
            glyph={INFO} glyphColor={COLORS.inkSoft} glyphBg={CHIP_INK}
            label="版本"
            value={`v${version}`}
            valueColor={COLORS.goldDeep}
            valueBold
            isLast
          />
        </Group>

        {/* 退出登录 */}
        <TouchableOpacity activeOpacity={0.8} style={styles.signOut} onPress={handleSignOut}>
          <Text fontSize={13} fontWeight="600" color={COLORS.danger}>退出登录</Text>
        </TouchableOpacity>
      </ScrollView>

      <PhoneBindingSheet
        visible={phoneSheet}
        currentPhone={phone}
        onClose={() => setPhoneSheet(false)}
        onSaved={setPhone}
      />
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize={10} color={COLORS.faint} letterSpacing={2}
      marginTop={16} marginBottom={6} paddingLeft={4}
    >
      {children}
    </Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <YStack
      backgroundColor={COLORS.surface}
      borderRadius={20}
      borderColor={COLORS.hairlineSoft}
      borderWidth={1}
      paddingHorizontal={16}
      style={SHADOW.card}
    >
      {children}
    </YStack>
  );
}

function Toggle({ value }: { value: boolean }) {
  return (
    <View
      style={{
        width: 42, height: 24, borderRadius: 12, padding: 3,
        backgroundColor: value ? COLORS.ink : COLORS.hairlineStrong,
        alignItems: value ? 'flex-end' : 'flex-start',
      }}
    >
      <View
        style={{
          width: 18, height: 18, borderRadius: 9,
          backgroundColor: COLORS.surfaceWarm,
          shadowColor: COLORS.text,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.25,
          shadowRadius: 3,
          elevation: 2,
        }}
      />
    </View>
  );
}

interface RowProps {
  glyph: IconGlyph;
  glyphColor: string;
  glyphBg: string;
  label: string;
  value?: string;
  valueColor?: string;
  /** 版本等需要强调的值 */
  valueBold?: boolean;
  chevron?: boolean;
  onPress?: () => void;
  toggle?: boolean;
  toggleValue?: boolean;
  onToggle?: (v: boolean) => void;
  isLast?: boolean;
  /** 置灰（如空数据时的导出按钮）：标签/图标变灰，仍可点击以给出提示 */
  dimmed?: boolean;
}

function Row({
  glyph, glyphColor, glyphBg, label, value, valueColor, valueBold,
  chevron, onPress, toggle, toggleValue, onToggle, isLast, dimmed,
}: RowProps) {
  const handlePress = onPress ?? (toggle && onToggle
    ? () => onToggle(!Boolean(toggleValue))
    : undefined);

  const content = (
    <XStack
      height={56} alignItems="center" space={12}
      borderBottomWidth={isLast ? 0 : 1}
      borderBottomColor={COLORS.divider}
      {...(toggle
        ? {
          accessibilityRole: 'switch' as const,
          accessibilityState: { checked: Boolean(toggleValue) },
        }
        : {})}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 11,
        backgroundColor: dimmed ? COLORS.divider : glyphBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke={dimmed ? COLORS.faint : glyphColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {glyph}
        </Svg>
      </View>
      <Text
        fontSize={13}
        fontWeight="500"
        color={dimmed ? COLORS.faint : COLORS.text}
        flex={1}
        numberOfLines={1}
      >
        {label}
      </Text>
      {value !== undefined ? (
        <Text
          fontSize={12}
          color={valueColor ?? COLORS.sub}
          fontWeight={valueBold ? '600' : '400'}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {toggle ? <Toggle value={Boolean(toggleValue)} /> : null}
      {chevron ? (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke={COLORS.faint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m9 18 6-6-6-6" />
        </Svg>
      ) : null}
    </XStack>
  );

  if (!handlePress) return content;
  return <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>{content}</TouchableOpacity>;
}

const styles = {
  signOut: {
    marginTop: 16, height: 46, borderRadius: 16,
    backgroundColor: SIGN_OUT_BG, borderColor: SIGN_OUT_LINE, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
} as const;
