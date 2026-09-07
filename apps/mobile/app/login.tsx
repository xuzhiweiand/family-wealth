/**
 * 登录/注册屏
 *
 * W2 用 Tamagui 组件 + InMemoryAuthClient 做演示
 * 真实流程：用户输入 → signIn() → 派生 UMK → setKeyStore → 进入主页
 */

import { useState } from 'react';
import { YStack, XStack, Text, Input, Button, Spinner } from 'tamagui';
import { useAuthStore } from '../src/stores/auth-store';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const onSubmit = async () => {
    if (mode === 'signin') {
      await signIn(email, password);
    } else {
      await signUp(email, password, displayName || email.split('@')[0] || '用户');
    }
  };

  const loading = status === 'loading';

  return (
    <YStack flex={1} backgroundColor="$bgSecondary" padding="$xl" space="$md" justifyContent="center">
      <Text fontSize="$6" fontWeight="700" color="$textPrimary" textAlign="center">
        家庭资产管理
      </Text>
      <Text fontSize="$3" color="$textSecondary" textAlign="center" marginBottom="$lg">
        端到端加密 · 数据只属于你
      </Text>

      <YStack space="$sm">
        {mode === 'signup' && (
          <Input
            placeholder="昵称"
            value={displayName}
            onChangeText={setDisplayName}
            backgroundColor="$bgPrimary"
            borderColor="$border"
          />
        )}
        <Input
          placeholder="邮箱"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          backgroundColor="$bgPrimary"
          borderColor="$border"
        />
        <Input
          placeholder="密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          backgroundColor="$bgPrimary"
          borderColor="$border"
        />
      </YStack>

      {error && (
        <Text color="$debt" fontSize="$2" textAlign="center">
          {error}
        </Text>
      )}

      <Button
        backgroundColor="$primary"
        color="white"
        onPress={onSubmit}
        disabled={loading || !email || !password}
        icon={loading ? <Spinner color="white" /> : undefined}
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
  );
}