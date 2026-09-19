/**
 * 应用根布局
 * - bootstrap 注入 AuthClient/Repositories
 * - TamaguiProvider 注入设计令牌
 * - 路由守卫：根据 auth status 跳转 login 或首页
 */

// 必须在任何可能用到 @noble/hashes 随机数的模块之前加载：
// Hermes 没有全局 crypto.getRandomValues，否则注册时
// salt/token 生成直接抛 "crypto.getRandomValues must be defined"。
import 'react-native-get-random-values';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { config } from '../tamagui.config';
import { bootstrap } from '../src/services/bootstrap';
import { useAuthStore } from '../src/stores/auth-store';
import { useFamilyStore } from '../src/stores/family-store';

bootstrap();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return; // hydrate 还没结束
    // OCR Lab 是开发态联调页，绕过 AuthGuard（无登录态也能用）
    // 注：expo-router typed-routes 在 .expo/types 未重生成时把 'ocr-lab'
    //     视为类型外值，这里用字符串常量绕过 TS 误报
    const head = segments[0] as string | undefined;
    if (head === 'ocr-lab') return;
    const inAuth = head === 'login';
    if (status === 'authenticated' && inAuth) {
      // 运行时根路径 '/' 解析到 (tabs)/index；typed-routes 生成的联合里
      // 只有 '/index' 与 '/(tabs)/index'，但二者在本工程均无法匹配，故显式转换
      router.replace('/' as Href);
    } else if (status !== 'authenticated' && !inAuth) {
      router.replace('/login');
    }
  }, [status, segments, router]);

  // 登录态建立后加载当前家庭：总览/资产/趋势首次进入即拿到真实 family，
  // 不必等用户手动打开家庭页（修复回归用户被误判为「无家庭」）
  useEffect(() => {
    if (status === 'authenticated') {
      useFamilyStore.getState().refresh();
    }
  }, [status]);

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
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" />
            <Stack.Screen name="family" />
            <Stack.Screen name="join" />
            <Stack.Screen name="asset/new" />
            <Stack.Screen name="asset/[id]" />
            <Stack.Screen name="asset/[id]/edit" />
            <Stack.Screen name="asset/trash" />
            <Stack.Screen name="ocr-lab" />
          </Stack>
        </AuthGuard>
      </SafeAreaProvider>
    </TamaguiProvider>
  );
}