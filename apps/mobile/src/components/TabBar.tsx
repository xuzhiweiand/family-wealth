/**
 * 自定义底部 Tab 栏
 *
 * 对照高保真原型：总览 · 资产 · [＋] · 趋势 · 我的。
 * 中间的绿色圆形「＋」不是一个 Tab，点击直接跳到资产录入页；
 * 其余四个按 @react-navigation/bottom-tabs 的标准 tabPress 语义切换。
 *
 * 这里不直接依赖 @react-navigation/bottom-tabs 的类型（避免 workspace
 * 间的隐式类型依赖），只声明用到的最小结构。
 */

import { TouchableOpacity, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconProps = { focused: boolean };

function HomeIcon({ focused }: IconProps) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"
      stroke={focused ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={focused ? 2.4 : 2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />
    </Svg>
  );
}

function LayersIcon({ focused }: IconProps) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"
      stroke={focused ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={focused ? 2.4 : 2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <Path d="m3 12 9 5 9-5" />
      <Path d="m3 17 9 5 9-5" />
    </Svg>
  );
}

function ChartIcon({ focused }: IconProps) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"
      stroke={focused ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={focused ? 2.4 : 2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 3v18h18" />
      <Path d="M8 17v-5" />
      <Path d="M13 17V8" />
      <Path d="M18 17v-3" />
    </Svg>
  );
}

function UserIcon({ focused }: IconProps) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"
      stroke={focused ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={focused ? 2.4 : 2}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </Svg>
  );
}

const ACTIVE_COLOR = '#10B981';
const INACTIVE_COLOR = '#9CA3AF';

interface TabRoute {
  key: string;
  name: string;
}

interface MinimalNavigation {
  navigate: (name: string) => void;
  emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => {
    defaultPrevented: boolean;
  };
}

interface TabBarProps {
  state: {
    index: number;
    routes: TabRoute[];
  };
  /**
   * expo-router 传入完整 BottomTab navigation，结构随 @react-navigation
   * 版本变化（且 exactOptionalPropertyTypes 下无法静态对齐）。边界用 unknown，
   * 组件内部收窄到实际用到的 navigate / emit。
   */
  navigation: unknown;
}

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const nav = navigation as MinimalNavigation;

  // 左两个 + 右两个，中间留给 FAB
  const left = state.routes.slice(0, 2);
  const right = state.routes.slice(2, 4);

  const renderTab = (route: TabRoute, absoluteIndex: number) => {
    const focused = state.index === absoluteIndex;
    const Icon = absoluteIndex === 0 ? HomeIcon
      : absoluteIndex === 1 ? LayersIcon
      : absoluteIndex === 2 ? ChartIcon
      : UserIcon;

    const onPress = () => {
      const event = nav.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) nav.navigate(route.name);
    };

    return (
      <TouchableOpacity key={route.key} style={styles.tab} onPress={onPress} activeOpacity={0.7}>
        <Icon focused={focused} />
        <View style={[styles.labelDot, { backgroundColor: focused ? ACTIVE_COLOR : 'transparent' }]} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {left.map((r, i) => renderTab(r, i))}
        <View style={styles.fabSlot}>
          <TouchableOpacity
            style={styles.fab}
            activeOpacity={0.85}
            onPress={() => nav.navigate('AssetNew')}
          >
            <Svg width={28} height={28} viewBox="0 0 24 24" fill="none"
              stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round">
              <Path d="M12 5v14M5 12h14" />
            </Svg>
          </TouchableOpacity>
        </View>
        {right.map((r, i) => renderTab(r, i + 2))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E5E7EB',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    height: 64,
    paddingBottom: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ACTIVE_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  labelDot: {
    marginTop: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
