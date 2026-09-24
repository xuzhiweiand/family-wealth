/**
 * 应用根组件（bare RN）
 *
 * - bootstrap 注入 AuthClient/Repositories
 * - TamaguiProvider 注入设计令牌
 * - 登录态驱动导航树：未 boot（hydrate 未完成）显示启动色屏；
 *   authenticated → 主 Stack；否则 → Login。
 *   注意：登录提交中 auth status 也会短暂变为 'loading'，因此用本地
 *   booted 标记区分「首次 hydrate」与「登录请求中」，避免登录页被卸载。
 */

import { useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { config } from './tamagui.config';
import { bootstrap } from './src/services/bootstrap';
import { useAuthStore } from './src/stores/auth-store';
import { useFamilyStore } from './src/stores/family-store';
import { navigationRef } from './src/lib/navigation';
import type { RootStackParamList, MainTabParamList } from './src/lib/navigation';
import { TabBar } from './src/components/TabBar';
import HomeScreen from './src/screens/tabs/HomeScreen';
import AssetsScreen from './src/screens/tabs/AssetsScreen';
import TrendsScreen from './src/screens/tabs/TrendsScreen';
import MeScreen from './src/screens/tabs/MeScreen';
import LoginScreen from './src/screens/LoginScreen';
import FamilyScreen from './src/screens/FamilyScreen';
import JoinScreen from './src/screens/JoinScreen';
import OcrLabScreen from './src/screens/OcrLabScreen';
import AssetNewScreen from './src/screens/AssetNewScreen';
import AssetTrashScreen from './src/screens/AssetTrashScreen';
import AssetDetailScreen from './src/screens/AssetDetailScreen';
import AssetEditScreen from './src/screens/AssetEditScreen';

bootstrap();

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Assets" component={AssetsScreen} />
      <Tab.Screen name="Trends" component={TrendsScreen} />
      <Tab.Screen name="Me" component={MeScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const status = useAuthStore((s) => s.status);
  const [booted, setBooted] = useState(false);

  // 首次挂载 hydrate 当前会话（Keychain → UMK/session 恢复）
  useEffect(() => {
    useAuthStore.getState().hydrate().finally(() => setBooted(true));
  }, []);

  // 登录态建立后加载当前家庭：总览/资产/趋势首次进入即拿到真实 family
  useEffect(() => {
    if (status === 'authenticated') {
      useFamilyStore.getState().refresh();
    }
  }, [status]);

  return (
    <TamaguiProvider config={config}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        {booted ? (
          <NavigationContainer ref={navigationRef}>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {status === 'authenticated' ? (
                <>
                  <Stack.Screen name="Main" component={MainTabs} />
                  <Stack.Screen name="Family" component={FamilyScreen} />
                  <Stack.Screen name="Join" component={JoinScreen} />
                  <Stack.Screen name="AssetNew" component={AssetNewScreen} />
                  <Stack.Screen name="AssetTrash" component={AssetTrashScreen} />
                  <Stack.Screen name="AssetDetail" component={AssetDetailScreen} />
                  <Stack.Screen name="AssetEdit" component={AssetEditScreen} />
                </>
              ) : (
                <Stack.Screen name="Login" component={LoginScreen} />
              )}
              {/* OCR Lab 是开发态联调页，无登录态也能进入（对齐原 AuthGuard 豁免） */}
              <Stack.Screen name="OcrLab" component={OcrLabScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        ) : (
          // hydrate 进行中：与原生启动屏同色的占位，避免白闪
          <View style={{ flex: 1, backgroundColor: '#10B981' }} />
        )}
      </SafeAreaProvider>
    </TamaguiProvider>
  );
}
