/**
 * 统一导航封装
 *
 * bare RN 迁移后 expo-router 的 useRouter/Href 全部废弃：
 * - 页面内用 useAppNavigation() 取得类型化 navigation（navigate/goBack/popToTop）
 * - 非组件上下文用 navigationRef
 *
 * 类型合并 RootStack 与 MainTab 两份 ParamList：tab 页内拿到的
 * navigation 最近上下文是 tab navigator，navigate('Trends') 由 tab
 * 处理；navigate('AssetDetail') 等不在 tab 路由表中的名字会自动
 * 冒泡到父级 stack —— 与 expo-router 的 push 语义对齐。
 */

import { createNavigationContainerRef, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type MainTabParamList = {
  Home: undefined;
  Assets: undefined;
  Trends: undefined;
  Me: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  Login: undefined;
  Family: undefined;
  Join: undefined;
  OcrLab: undefined;
  AssetNew: undefined;
  AssetTrash: undefined;
  AssetDetail: { id: string };
  AssetEdit: { id: string };
};

export type AppNavigation = NativeStackNavigationProp<RootStackParamList & MainTabParamList>;

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}
