/**
 * 登录/注册屏
 *
 * W2 用 Tamagui 组件 + InMemoryAuthClient 做演示
 * 真实流程：用户输入 → signIn() → 派生 UMK → setKeyStore → 进入主页
 *
 * 0.1.5：自动登录由 Keychain 持久化 UMK+session 实现，无需记住密码功能
 * 0.5.0：新增华为账号登录（官方红色胶囊按钮，置于页面底部）
 */

import { useState } from 'react';
import { Alert, Linking, TouchableOpacity, View } from 'react-native';
import { YStack, XStack, Text, Input, Button, Spinner } from 'tamagui';
import { useAuthStore } from '../stores/auth-store';
import { PRIVACY_POLICY_URL } from '../services/privacy-consent';
import {
  isHuaweiAccountAvailable,
  requestHuaweiAuthorization,
} from '../services/huawei-auth';

/** 华为红（官方华为帐号登录按钮标准色） */
const HUAWEI_RED = '#CE0E2D';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [agreed, setAgreed] = useState(false);
  const [huaweiLoading, setHuaweiLoading] = useState(false);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const signInWithHuawei = useAuthStore((s) => s.signInWithHuawei);
  const huaweiAvailable = isHuaweiAccountAvailable();

  const onSubmit = async () => {
    if (!agreed) return;
    if (mode === 'signin') {
      await signIn(email, password);
    } else {
      await signUp(email, password, displayName || email.split('@')[0] || '用户');
    }
  };

  const runHuaweiLogin = async () => {
    if (huaweiLoading) return;
    setHuaweiLoading(true);
    try {
      const result = await requestHuaweiAuthorization();
      if (!result.ok) {
        if (result.reason === 'cancelled') return;
        Alert.alert('华为账号登录', result.message);
        return;
      }
      await signInWithHuawei(result.data.authorizationCode, result.data.state);
    } finally {
      setHuaweiLoading(false);
    }
  };

  const onHuaweiPress = () => {
    if (huaweiLoading) return;
    // 未同意隐私政策：弹窗确认，用户点「同意并继续」即自动勾选并继续登录
    if (!agreed) {
      Alert.alert('请先同意隐私政策', '同意后才能使用华为账号登录', [
        { text: '取消', style: 'cancel' },
        {
          text: '同意并继续',
          onPress: () => {
            setAgreed(true);
            void runHuaweiLogin();
          },
        },
      ]);
      return;
    }
    void runHuaweiLogin();
  };

  const loading = status === 'loading';

  return (
    <YStack flex={1} backgroundColor="$bgSecondary" padding="$xl">
      <YStack flex={1} justifyContent="center" space="$md">
        <Text fontSize="$6" fontWeight="700" color="$textPrimary" textAlign="center">
          家庭资产管理
        </Text>
        <Text fontSize="$3" color="$textSecondary" textAlign="center" marginBottom="$lg">
          端到端加密 · 数据只属于你
        </Text>

        <YStack space="$sm">
          {mode === 'signup' && (
            <Input
              height={48}
              fontSize={16}
              paddingHorizontal={16}
              placeholder="昵称"
              value={displayName}
              onChangeText={setDisplayName}
              backgroundColor="$bgPrimary"
              borderColor="$border"
            />
          )}
          <Input
            height={48}
            fontSize={16}
            paddingHorizontal={16}
            placeholder="邮箱"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
          <Input
            height={48}
            fontSize={16}
            paddingHorizontal={16}
            placeholder="密码"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
        </YStack>

        {error && (
          <Text color="$debt" fontSize="$2" textAlign="center">
            {error}
          </Text>
        )}

        {/* 合规：登录/注册前须同意隐私政策（AppGallery 审核要求） */}
        <XStack alignItems="flex-start" space="$xs" marginTop="$sm">
          <TouchableOpacity onPress={() => setAgreed(!agreed)} hitSlop={8} activeOpacity={0.7}>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: agreed ? '#10B981' : '#D1D5DB',
                backgroundColor: agreed ? '#10B981' : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 1,
              }}
            >
              {agreed ? (
                <Text color="white" fontSize={12} fontWeight="700" lineHeight={14}>
                  ✓
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
          <Text fontSize="$2" color="$textSecondary" flex={1} lineHeight={20}>
            我已阅读并同意
            <Text
              color="$primary"
              onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            >
              《隐私政策》
            </Text>
          </Text>
        </XStack>

        <Button
          size={52}
          fontSize={18}
          marginTop={8}
          backgroundColor="$primary"
          color="white"
          onPress={onSubmit}
          disabled={loading || !email || !password || !agreed}
          opacity={!agreed ? 0.5 : 1}
          {...(loading ? { icon: <Spinner color="white" /> } : {})}
        >
          {loading ? '处理中...' : mode === 'signin' ? '登录' : '注册'}
        </Button>

        <XStack justifyContent="center" space="$sm">
          <Text fontSize="$2" color="$textSecondary">
            {mode === 'signin' ? '还没有账号？' : '已有账号？'}
          </Text>
          <Text
            fontSize="$2"
            color="$primary"
            pressStyle={{ opacity: 0.6 }}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? '立即注册' : '去登录'}
          </Text>
        </XStack>
      </YStack>

      {/* 华为账号登录：官方规范红色胶囊按钮，置于页面底部 */}
      {huaweiAvailable && (
        <TouchableOpacity
          onPress={onHuaweiPress}
          activeOpacity={0.9}
          disabled={huaweiLoading}
          accessibilityRole="button"
          accessibilityLabel="华为账号登录"
        >
          <XStack
            height={48}
            borderRadius={24}
            backgroundColor={HUAWEI_RED}
            alignItems="center"
            justifyContent="center"
            paddingHorizontal="$lg"
          >
            {huaweiLoading ? (
              <Spinner color="white" size="small" />
            ) : (
              <Text fontSize={17} fontWeight="600" color="white">
                华为账号登录
              </Text>
            )}
          </XStack>
        </TouchableOpacity>
      )}
    </YStack>
  );
}
