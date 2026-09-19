/**
 * 主壳 Tab 布局
 *
 * 四个真实 Tab（总览 / 资产 / 趋势 / 我的），中间「＋」由自定义 TabBar
 * 渲染并跳转让位（不是 Tab）。技术方案 §7 的主壳在此落地。
 */

import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';

export default function MainTabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="assets" />
      <Tabs.Screen name="trends" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
