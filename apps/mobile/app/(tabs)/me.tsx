/**
 * 我的
 *
 * 分组对齐高保真原型：
 *  - 用户信息头
 *  - 当前家庭（名称 / 角色 / 管理）
 *  - 安全与隐私（端到端加密 / 生物识别 / 本地备份）
 *  - 功能（异动提醒 / 导出报表 / 帮助反馈）
 *  - 关于（版本）+ 退出登录
 *
 * 安全开关是本机偏好；端到端加密由架构保证、恒为开启。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, ScrollView, Switch, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Text, XStack, YStack } from 'tamagui';
import { ROLE_LABELS } from '@family-wealth/family';
import { useAuthStore } from '../../src/stores/auth-store';
import { useAssetStore } from '../../src/stores/asset-store';
import { useFamilyStore, useMyFamilyRole } from '../../src/stores/family-store';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { exportAssetsCsv } from '../../src/services/export';

type IconGlyph = React.ReactNode;

const LOCK: IconGlyph = (
  <>
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <Path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
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
const BELL: IconGlyph = (
  <>
    <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <Path d="M10 20a2 2 0 0 0 4 0" />
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
    <Path d="M9.5 9a2.5 2.5 0 0 1 4.4 1.6c0 1.7-1.9 2.2-1.9 3.6" />
    <Path d="M12 17.5h.01" />
    <Path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />
  </>
);
const HOME: IconGlyph = (
  <>
    <Path d="m3 11 9-8 9 8" />
    <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
  </>
);

export default function MeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const assets = useAssetStore((s) => s.assets);

  const family = useFamilyStore((s) => s.family);
  const refresh = useFamilyStore((s) => s.refresh);
  const role = useMyFamilyRole();

  // 本机偏好开关
  const [biometric, setBiometric] = useState(false);
  const [notify, setNotify] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeAssets = useMemo(
    () => assets.filter((a) => a.deletedAt === null),
    [assets],
  );

  const version = Constants.expoConfig?.version ?? '0.1.0';

  const handleExport = async () => {
    if (exporting) return;
    if (activeAssets.length === 0) {
      Alert.alert('暂无数据', '还没有可导出的资产，先录入几笔吧');
      return;
    }
    setExporting(true);
    try {
      const result = await exportAssetsCsv(activeAssets);
      if (result.shared) return;
      Alert.alert('已生成报表', `系统分享不可用，文件已保存到：\n${result.uri}`);
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
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={{ height: insets.top, backgroundColor: '#F9FAFB' }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 用户信息头 */}
        <XStack space="$md" alignItems="center" marginBottom="$lg">
          <View style={{
            width: 64, height: 64, borderRadius: 32, backgroundColor: '#10B981',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text fontSize="$7" fontWeight="700" color="white">
              {(user?.displayName ?? '我').slice(0, 1)}
            </Text>
          </View>
          <YStack flex={1}>
            <Text fontSize="$5" fontWeight="700" color="$textPrimary">
              {user?.displayName ?? '未登录'}
            </Text>
            <Text fontSize="$2" color="$textTertiary" marginTop={2}>
              {user?.email ?? '—'}
            </Text>
          </YStack>
        </XStack>

        {/* 当前家庭 */}
        <Group>
          <Row
            glyph={HOME} glyphColor="#059669" glyphBg="#D1FAE5"
            label={family ? family.name : '尚未加入家庭'}
            {...(family ? { value: ROLE_LABELS[role] } : {})}
            chevron
            onPress={() => router.push('/family')}
          />
        </Group>

        {/* 安全与隐私 */}
        <SectionLabel>安全与隐私</SectionLabel>
        <Group>
          <Row
            glyph={LOCK} glyphColor="#059669" glyphBg="#D1FAE5"
            label="端到端加密"
            value="已开启"
            valueColor="#059669"
          />
          <Row
            glyph={FINGERPRINT} glyphColor="#2563EB" glyphBg="#DBEAFE"
            label="生物识别解锁"
            toggle
            toggleValue={biometric}
            onToggle={setBiometric}
            isLast
          />
          <Row
            glyph={BACKUP} glyphColor="#D97706" glyphBg="#FEF3C7"
            label="本地备份"
            chevron
            onPress={() => Alert.alert('本地备份', '加密备份到本机文件的能力将在下一版本提供')}
          />
        </Group>

        {/* 功能 */}
        <SectionLabel>功能</SectionLabel>
        <Group>
          <Row
            glyph={BELL} glyphColor="#DC2626" glyphBg="#FEE2E2"
            label="异动提醒"
            toggle
            toggleValue={notify}
            onToggle={setNotify}
          />
          <Row
            glyph={DOWNLOAD} glyphColor="#7C3AED" glyphBg="#EDE9FE"
            label={exporting ? '正在导出…' : '导出报表'}
            chevron
            onPress={handleExport}
          />
          <Row
            glyph={HELP} glyphColor="#0891B2" glyphBg="#CFFAFE"
            label="帮助与反馈"
            chevron
            isLast
            onPress={() => Alert.alert('帮助与反馈', '可通过邮箱或家庭群联系我们')}
          />
        </Group>

        {/* 关于 */}
        <SectionLabel>关于</SectionLabel>
        <Group>
          <Row
            glyph={HOME} glyphColor="#6B7280" glyphBg="#F3F4F6"
            label="版本"
            value={`v${version}`}
            isLast
          />
        </Group>

        {/* 退出登录 */}
        <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
          <Text fontSize="$3" fontWeight="600" color="#DC2626">退出登录</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="$2" color="$textTertiary" fontWeight="600"
      marginTop="$lg" marginBottom="$sm" marginLeft="$xs">
      {children}
    </Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <YStack backgroundColor="white" borderRadius="$lg"
      borderColor="$border" borderWidth={1} overflow="hidden">
      {children}
    </YStack>
  );
}

interface RowProps {
  glyph: IconGlyph;
  glyphColor: string;
  glyphBg: string;
  label: string;
  value?: string;
  valueColor?: string;
  chevron?: boolean;
  onPress?: () => void;
  toggle?: boolean;
  toggleValue?: boolean;
  onToggle?: (v: boolean) => void;
  isLast?: boolean;
}

function Row({
  glyph, glyphColor, glyphBg, label, value, valueColor,
  chevron, onPress, toggle, toggleValue, onToggle, isLast,
}: RowProps) {
  const content = (
    <XStack
      paddingHorizontal="$md" height={56} alignItems="center" space="$md"
      borderBottomColor={isLast ? 'transparent' : '#F3F4F6'}
      borderBottomWidth={isLast ? 0 : 1}
    >
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: glyphBg,
        alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
          stroke={glyphColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {glyph}
        </Svg>
      </View>
      <Text fontSize="$3" color="$textPrimary" flex={1}>{label}</Text>
      {value !== undefined ? (
        <Text fontSize="$2" color={valueColor ?? '$textTertiary'}>{value}</Text>
      ) : null}
      {toggle ? (
        <Switch
          value={toggleValue}
          onValueChange={onToggle}
          trackColor={{ true: '#10B981', false: '#D1D5DB' }}
          thumbColor="white"
        />
      ) : null}
      {chevron ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
          stroke="#9CA3AF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m9 6 6 6-6 6" />
        </Svg>
      ) : null}
    </XStack>
  );
  if (onPress && !toggle) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  }
  return content;
}

const styles = {
  signOut: {
    marginTop: 24, height: 50, borderRadius: 14,
    backgroundColor: 'white', borderColor: '#FECACA', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
} as const;
