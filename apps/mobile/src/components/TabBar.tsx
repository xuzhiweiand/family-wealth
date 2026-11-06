/**
 * 自定义底部 Tab 栏
 *
 * 对照 v0.6.0 高保真稿：首页 / 趋势 / 更新 / 报表 / 我的，5 等分，无中央 FAB。
 * 选中项墨绿 + 金色 4px 圆点，未选中 faint；容器暖白 + 发丝上边线。
 *
 * 这里不直接依赖 @react-navigation/bottom-tabs 的类型（避免 workspace
 * 间的隐式类型依赖），只声明用到的最小结构。
 */

import { COLORS } from '../theme';
import { TouchableOpacity, View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_LABELS: Record<string, string> = {
  Home: '首页',
  Trends: '趋势',
  Update: '更新',
  Report: '报表',
  Me: '我的',
};

type IconProps = { focused: boolean };

const strokeOf = (focused: boolean) => (focused ? COLORS.ink : COLORS.faint);

function HomeIcon({ focused }: IconProps) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
      stroke={strokeOf(focused)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m3 11 9-8 9 8" />
      <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
    </Svg>
  );
}

function TrendIcon({ focused }: IconProps) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
      stroke={strokeOf(focused)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <Path d="m19 9-5 5-4-4-3 3" />
    </Svg>
  );
}

function UpdateIcon({ focused }: IconProps) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
      stroke={strokeOf(focused)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

function ReportIcon({ focused }: IconProps) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
      stroke={strokeOf(focused)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect width={16} height={20} x={4} y={2} rx={2} />
      <Path d="M8 7h8M8 11h8M8 15h5" />
    </Svg>
  );
}

function UserIcon({ focused }: IconProps) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none"
      stroke={strokeOf(focused)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </Svg>
  );
}

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  Home: HomeIcon,
  Trends: TrendIcon,
  Update: UpdateIcon,
  Report: ReportIcon,
  Me: UserIcon,
};

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
  navigation: unknown;
}

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const nav = navigation as MinimalNavigation;

  const renderTab = (route: TabRoute, index: number) => {
    const focused = state.index === index;
    const Icon = ICONS[route.name] ?? HomeIcon;

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
        <Text style={[styles.label, focused ? styles.labelActive : null]}>
          {TAB_LABELS[route.name] ?? route.name}
        </Text>
        <View style={[styles.dot, focused ? styles.dotActive : null]} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {state.routes.map((r, i) => renderTab(r, i))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surfaceWarm,
    borderTopColor: COLORS.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  row: {
    flexDirection: 'row',
    height: 66,
    paddingTop: 6,
    paddingHorizontal: 16,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  label: {
    marginTop: 2,
    fontSize: 9.5,
    color: COLORS.faint,
  },
  labelActive: {
    color: COLORS.ink,
    fontWeight: '600',
  },
  dot: {
    width: 4,
    height: 4,
    marginTop: 3,
    borderRadius: 2,
    backgroundColor: COLORS.transparent,
  },
  dotActive: {
    backgroundColor: COLORS.gold,
  },
});
