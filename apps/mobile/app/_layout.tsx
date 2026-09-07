/**
 * 应用根布局
 * - bootstrap 注入 AuthClient/Repositories
 * - TamaguiProvider 注入设计令牌
 * - 路由守卫：根据 auth status 跳转 login 或首页
 */

import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { config } from '../tamagui.config';
import { bootstrap } from '../src/services/bootstrap';
import { useAuthStore } from '../src/stores/auth-store';

bootstrap();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'idle') return; // hydrate 还没结束
    const inAuth = segments[0] === 'login';
    if (status === 'authenticated' && inAuth) {
      router.replace('/');
    } else if (status !== 'authenticated' && !inAuth) {
      router.replace('/login');
    }
  }, [status, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  // 首次挂载 hydrate 当前会话
  useEffect(() => {
    useAuthStore.getState().hydrate();
  }, []);

  return (
    <TamaguiProvider config={config}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthGuard>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </TamaguiProvider>
  );
}