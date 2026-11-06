/**
 * 华为账号登录 · 加密密码过渡页
 *
 * 华为账号只负责身份鉴权，资产仍由本地派生的 UMK 加密：
 *  - 首次登录（尚无 profiles 档案）→ 引导设置一次加密主密码
 *  - 已有档案 → 输入原加密主密码，校验通过后才进入主页
 */

import { COLORS } from '../theme';
import { FONT, SERIF_CN_TEXT } from '../typography';
import { useState } from 'react';
import { Alert, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, Input, Spinner, Text, XStack, YStack } from 'tamagui';
import { useAuthStore } from '../stores/auth-store';

const LOCK_GLYPH = (
  <>
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <Path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
  </>
);

const KEY_GLYPH = (
  <>
    <Path d="m15.5 7.5 5 5" />
    <Path d="M20.5 12.5 18 15l-2.5-2.5" />
    <Path d="M2 16a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z" />
    <Path d="m8 13 1.5 1.5" />
  </>
);

function LockBadge({ firstTime }: { firstTime: boolean }) {
  return (
    <View style={{
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: firstTime ? COLORS.inkWashSoft : COLORS.inkWashSoft,
      alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    }}>
      <Svg
        width={28}
        height={28}
        viewBox="0 0 24 24"
        fill="none"
        stroke={firstTime ? COLORS.inkSoft : COLORS.inkSoft}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {firstTime ? LOCK_GLYPH : KEY_GLYPH}
      </Svg>
    </View>
  );
}

type SetupMode = 'create' | 'bind';

function passwordStrength(pwd: string): number {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[a-zA-Z]/.test(pwd) && /\d/.test(pwd)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = [COLORS.hairline, COLORS.danger, COLORS.warning, COLORS.ink, COLORS.inkSoft];
const STRENGTH_LABELS = ['', '太弱', '一般', '良好', '很强'];

export default function HuaweiKeySetupScreen() {
  const pending = useAuthStore((s) => s.pendingHuawei);
  const error = useAuthStore((s) => s.error);
  const completeHuaweiLogin = useAuthStore((s) => s.completeHuaweiLogin);
  const bindHuaweiToEmail = useAuthStore((s) => s.bindHuaweiToEmail);
  const cancelHuaweiLogin = useAuthStore((s) => s.cancelHuaweiLogin);

  const [mode, setMode] = useState<SetupMode>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isFirstTime = !pending?.account.profile;
  const isBind = isFirstTime && mode === 'bind';
  const strength = passwordStrength(password);
  const canSubmit = isBind
    ? email.includes('@') && password.length >= 8
    : isFirstTime
      ? password.length >= 8 && password === confirm
      : password.length >= 8;

  const handleBack = () => {
    if (submitting) return;
    Alert.alert('取消登录', '将退出本次华为账号登录，确定继续吗？', [
      { text: '继续填写', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          void cancelHuaweiLogin();
        },
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    if (!isBind && isFirstTime && password !== confirm) {
      Alert.alert('两次输入不一致', '请重新确认加密主密码');
      return;
    }
    setSubmitting(true);
    try {
      if (isBind) {
        await bindHuaweiToEmail(email.trim().toLowerCase(), password);
      } else {
        await completeHuaweiLogin(password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <YStack flex={1} backgroundColor="$bgSecondary">
      <XStack
        height={56}
        alignItems="center"
        paddingHorizontal="$md"
        borderBottomColor="$border"
        borderBottomWidth={1}
        backgroundColor="$bgSecondary"
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12}>
          <Text fontSize="$6" color="$textPrimary">‹</Text>
        </TouchableOpacity>
        <Text flex={1} textAlign="center" fontSize="$3" fontWeight="700" color={COLORS.text}
          style={SERIF_CN_TEXT} letterSpacing={1}>
          华为账号登录
        </Text>
        <View style={{ width: 24 }} />
      </XStack>

      <YStack flex={1} padding="$xl" space="$lg" justifyContent="center">
        <YStack space="$xs" alignItems="center">
          <LockBadge firstTime={isFirstTime} />
          <Text fontSize="$6" fontWeight="700" color={COLORS.text} textAlign="center"
            style={SERIF_CN_TEXT} letterSpacing={2}>
            {isFirstTime ? '设置加密主密码' : '输入加密主密码'}
          </Text>
          <Text fontSize="$2" color="$textSecondary" textAlign="center" lineHeight={20}>
            {isFirstTime
              ? '华为账号用于身份验证；你的资产仍由只保存在本机的加密密码保护。'
              : `已找到「${pending?.account.displayName ?? '华为用户'}」的加密档案，请输入原主密码继续。`}
          </Text>
        </YStack>

        {isFirstTime && (
          <XStack space={8}>
            {([['create', '创建新账号'], ['bind', '绑定已有邮箱账号']] as const).map(([key, label]) => (
              <Button
                key={key}
                flex={1}
                height={38}
                borderRadius={19}
                backgroundColor={mode === key ? COLORS.ink : COLORS.surface}
                borderWidth={1}
                borderColor={mode === key ? COLORS.ink : COLORS.hairline}
                pressStyle={{ opacity: 0.85 }}
                onPress={() => setMode(key)}
              >
                <Text fontSize={13} fontWeight="600" color={mode === key ? COLORS.surface : COLORS.sub}>
                  {label}
                </Text>
              </Button>
            ))}
          </XStack>
        )}

        <YStack space="$sm" marginTop="$md">
          {isBind && (
            <Input
              height={50}
              fontSize={16}
              paddingHorizontal={16}
              placeholder="原账号邮箱"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              backgroundColor={COLORS.surface}
              borderColor={COLORS.hairline}
              borderRadius={14}
              marginBottom={4}
            />
          )}
          <Text fontSize="$2" color="$textSecondary" fontWeight="600">
            {isBind ? '该账号的登录密码（即加密主密码）' : isFirstTime ? '密码至少 8 位' : '原有加密主密码'}
          </Text>
          <Input
            height={50}
            fontSize={16}
            paddingHorizontal={16}
            placeholder={
              isBind ? '请输入该账号密码' : isFirstTime ? '设置加密主密码' : '请输入原加密主密码'
            }
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            backgroundColor={COLORS.surface}
            borderColor={COLORS.hairline}
            borderRadius={14}
          />

          {isFirstTime && !isBind && (
            <>
              <XStack space={4} marginTop={2}>
                {[1, 2, 3, 4].map((i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: strength >= i ? STRENGTH_COLORS[strength] : COLORS.hairline,
                    }}
                  />
                ))}
              </XStack>
              <Text fontSize="$1" color="$textTertiary">
                {password ? `密码强度：${STRENGTH_LABELS[strength]}` : '建议使用字母 + 数字 + 符号组合'}
              </Text>
              <Input
                height={50}
                fontSize={16}
                paddingHorizontal={16}
                placeholder="再次输入以确认"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                backgroundColor={COLORS.surface}
                borderColor={COLORS.hairline}
                borderRadius={14}
                marginTop={4}
              />
            </>
          )}
        </YStack>

        {error && (
          <Text color="$debt" fontSize="$2" textAlign="center">
            {error}
          </Text>
        )}

        {isFirstTime && !isBind && (
          <YStack backgroundColor={COLORS.warningWash} borderRadius="$md" padding="$md">
            <Text fontSize="$2" color={COLORS.goldDeep} lineHeight={19}>
              加密密码无法由服务器找回，丢失后将无法解密已同步的数据。请务必自行记录。
            </Text>
          </YStack>
        )}

        {isBind && (
          <YStack backgroundColor={COLORS.inkWashSoft} borderRadius="$md" padding="$md">
            <Text fontSize="$2" color="$primary" lineHeight={19}>
              绑定后，华为账号将与该邮箱账号关联，下次可直接用华为账号登录；数据与加密密码保持不变。
            </Text>
          </YStack>
        )}

        <Button
          size={52}
          fontSize={17}
          borderRadius={16}
          letterSpacing={2}
          backgroundColor={COLORS.ink}
          color={COLORS.surface}
          marginTop="$sm"
          onPress={handleSubmit}
          disabled={submitting || !canSubmit}
          opacity={canSubmit ? 1 : 0.5}
          {...(submitting ? { icon: <Spinner color={COLORS.surface} /> } : {})}
        >
          {submitting ? '处理中...' : isBind ? '绑定并进入' : isFirstTime ? '设置并进入' : '验证并进入'}
        </Button>
      </YStack>
    </YStack>
  );
}
