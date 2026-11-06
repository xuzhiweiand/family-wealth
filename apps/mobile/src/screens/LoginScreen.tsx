/**
 * 登录/注册屏（浅色纸感 + 墨绿鎏金点缀，提升文字对比度）
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-login.html」复刻。
 *
 * W2 用 Tamagui 组件 + InMemoryAuthClient 做演示
 * 真实流程：用户输入 → signIn() → 派生 UMK → setKeyStore → 进入主页
 *
 * 0.1.5：自动登录由 Keychain 持久化 UMK+session 实现，无需记住密码功能
 * 0.5.0：新增华为账号登录（置于页面底部）
 * 0.6.1：改浅色纸感背景提升可读性，移除冗余的返回/帮助入口
 */

import { COLORS } from '../theme';
import { SERIF_CN_TEXT } from '../typography';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { Spinner, Text, XStack, YStack } from 'tamagui';
import { useAuthStore } from '../stores/auth-store';
import { PRIVACY_POLICY_URL } from '../services/privacy-consent';
import {
  isHuaweiAccountAvailable,
  requestHuaweiAuthorization,
} from '../services/huawei-auth';

/** 金色发丝分隔线（透明 → 金 → 透明，对照设计稿 hairline-gold） */
function GoldHairline({ width }: { width: number | '100%' }) {
  return (
    <Svg width={width} height={1}>
      <Defs>
        <LinearGradient id="loginHairlineGold" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={COLORS.gold} stopOpacity={0} />
          <Stop offset="0.5" stopColor={COLORS.gold} stopOpacity={0.5} />
          <Stop offset="1" stopColor={COLORS.gold} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={1} fill="url(#loginHairlineGold)" />
    </Svg>
  );
}

/** 浅色纸感底：米色底 + 右上金色 / 左下墨绿局部径向柔光 + 同心金环（对照 paper 底纹） */
function Backdrop({ width, height }: { width: number; height: number }) {
  const goldCx = width * 0.85;
  const goldCy = -height * 0.08;
  const goldR = Math.min(700, width * 1.8);
  const inkCx = -width * 0.12;
  const inkCy = height * 0.3;
  const inkR = Math.min(520, width * 1.3);
  return (
    <Svg width={width} height={height} style={styles.backdrop} pointerEvents="none">
      <Defs>
        <RadialGradient id="loginGoldRadial" gradientUnits="userSpaceOnUse" cx={goldCx} cy={goldCy} r={goldR}>
          <Stop offset="0" stopColor="#C6A15B" stopOpacity={0.08} />
          <Stop offset="0.6" stopColor="#C6A15B" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="loginInkRadial" gradientUnits="userSpaceOnUse" cx={inkCx} cy={inkCy} r={inkR}>
          <Stop offset="0" stopColor="#0B3D2E" stopOpacity={0.05} />
          <Stop offset="0.55" stopColor="#0B3D2E" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={COLORS.paper} />
      <Circle cx={goldCx} cy={goldCy} r={goldR} fill="url(#loginGoldRadial)" />
      <Circle cx={inkCx} cy={inkCy} r={inkR} fill="url(#loginInkRadial)" />
      <Circle cx={width - 74} cy={-96} r={115} stroke="#C6A15B" strokeOpacity={0.14} strokeWidth={1} fill="none" />
      <Circle cx={width - 22} cy={-44} r={78} stroke="#C6A15B" strokeOpacity={0.10} strokeWidth={1} fill="none" />
    </Svg>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | 'name' | null>(null);
  const [huaweiLoading, setHuaweiLoading] = useState(false);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const signInWithHuawei = useAuthStore((s) => s.signInWithHuawei);
  const huaweiAvailable = isHuaweiAccountAvailable();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

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
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <Backdrop width={width} height={Math.max(1, height)} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 18) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.inner}>
            {/* 品牌（对照高保真：墨绿芯片 + 衬线标题 + 金丝线 + 副标题） */}
            <YStack alignItems="center" marginTop={40} marginBottom={40}>
              <View style={styles.brandChip}>
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none"
                  stroke={COLORS.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="m3 11 9-8 9 8" />
                  <Path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
                </Svg>
              </View>
              <Text fontSize={26} color={COLORS.ink} letterSpacing={8} style={SERIF_CN_TEXT}>
                家 资
              </Text>
              <View style={styles.brandHairline}>
                <GoldHairline width={64} />
              </View>
              <Text fontSize={10.5} color={COLORS.sub} letterSpacing={3}>
                家庭资产管理 · 端到端加密
              </Text>
            </YStack>

            {/* 表单卡 */}
            <YStack style={styles.card}>
              {mode === 'signup' && (
                <YStack marginBottom={20}>
                  <Text fontSize={10} color={COLORS.sub} letterSpacing={2} marginBottom={2}>
                    昵称
                  </Text>
                  <TextInput
                    style={[styles.input, { borderBottomColor: focused === 'name' ? COLORS.gold : COLORS.hairline }]}
                    value={displayName}
                    onChangeText={setDisplayName}
                    onFocus={() => setFocused('name')}
                    onBlur={() => setFocused(null)}
                    placeholder="如何称呼你"
                    placeholderTextColor={COLORS.faint}
                    selectionColor={COLORS.gold}
                    autoCorrect={false}
                    accessibilityLabel="昵称"
                  />
                </YStack>
              )}

              <YStack marginBottom={20}>
                <Text fontSize={10} color={COLORS.sub} letterSpacing={2} marginBottom={2}>
                  邮箱
                </Text>
                <TextInput
                  style={[styles.input, { borderBottomColor: focused === 'email' ? COLORS.gold : COLORS.hairline }]}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocused('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="请输入邮箱地址"
                  placeholderTextColor={COLORS.faint}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  selectionColor={COLORS.gold}
                  accessibilityLabel="邮箱"
                />
              </YStack>

              <YStack marginBottom={4}>
                <Text fontSize={10} color={COLORS.sub} letterSpacing={2} marginBottom={2}>
                  密码
                </Text>
                <View>
                  <TextInput
                    style={[styles.input, styles.passwordInput, { borderBottomColor: focused === 'password' ? COLORS.gold : COLORS.hairline }]}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    placeholder="请输入密码"
                    placeholderTextColor={COLORS.faint}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    selectionColor={COLORS.gold}
                    accessibilityLabel="密码"
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={10}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
                      stroke={COLORS.sub} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                      {showPassword ? (
                        <>
                          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                          <Circle cx={12} cy={12} r={3} />
                        </>
                      ) : (
                        <>
                          <Path d="M9.9 4.24A9.5 9.5 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                          <Path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                          <Path d="m2 2 20 20M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        </>
                      )}
                    </Svg>
                  </TouchableOpacity>
                </View>
              </YStack>

              {error && (
                <View style={styles.errorPill}>
                  <Text fontSize={11} color={COLORS.danger} textAlign="center" lineHeight={16}>
                    {error}
                  </Text>
                </View>
              )}

              {/* 合规：登录/注册前须同意隐私政策（AppGallery 审核要求） */}
              <XStack alignItems="flex-start" space={10} marginTop={16} marginBottom={16}>
                <TouchableOpacity
                  onPress={() => setAgreed(!agreed)}
                  hitSlop={8}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  accessibilityLabel="同意用户协议与隐私政策"
                >
                  <View style={[
                    styles.checkbox,
                    agreed ? styles.checkboxOn : null,
                  ]}>
                    {agreed ? (
                      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none"
                        stroke={COLORS.surface} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <Path d="M20 6 9 17l-5-5" />
                      </Svg>
                    ) : null}
                  </View>
                </TouchableOpacity>
                <Text flex={1} fontSize={10.5} color={COLORS.sub} lineHeight={17}>
                  我已阅读并同意
                  <Text color={COLORS.goldDeep}>《用户协议》</Text>
                  与
                  <Text
                    color={COLORS.goldDeep}
                    onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
                  >
                    《隐私政策》
                  </Text>
                </Text>
              </XStack>

              <TouchableOpacity
                onPress={onSubmit}
                disabled={loading || !email || !password || !agreed}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={mode === 'signin' ? '登录' : '注册'}
              >
                <View style={[styles.primaryBtn, { opacity: !agreed ? 0.5 : 1 }]}>
                  {loading ? (
                    <Spinner color={COLORS.inkDeep} size="small" />
                  ) : (
                    <Text fontSize={15} fontWeight="600" color={COLORS.inkDeep} letterSpacing={6}>
                      {mode === 'signin' ? '登 录' : '注 册'}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              <XStack justifyContent="center" marginTop={16}>
                {mode === 'signin' ? (
                  <>
                    <Text fontSize={11} color={COLORS.sub}>
                      还没有账号？
                    </Text>
                    <Text
                      fontSize={11}
                      color={COLORS.goldDeep}
                      pressStyle={{ opacity: 0.6 }}
                      onPress={() => setMode('signup')}
                    >
                      创建账号
                    </Text>
                  </>
                ) : (
                  <Text
                    fontSize={11}
                    color={COLORS.goldDeep}
                    pressStyle={{ opacity: 0.6 }}
                    onPress={() => setMode('signin')}
                  >
                    已有账号？去登录
                  </Text>
                )}
              </XStack>
            </YStack>

            <View style={styles.spacer} />

            {/* 底部：分隔线 + 华为一键登录 + 合规说明 */}
            <YStack>
              {huaweiAvailable && (
                <>
                  <XStack alignItems="center" space={12} marginBottom={16}>
                    <View style={styles.dividerLine}>
                      <GoldHairline width="100%" />
                    </View>
                    <Text fontSize={10} color={COLORS.faint} letterSpacing={2}>
                      或
                    </Text>
                    <View style={styles.dividerLine}>
                      <GoldHairline width="100%" />
                    </View>
                  </XStack>

                  <TouchableOpacity
                    onPress={onHuaweiPress}
                    activeOpacity={0.85}
                    disabled={huaweiLoading}
                    accessibilityRole="button"
                    accessibilityLabel="华为账号登录"
                  >
                    <XStack
                      height={48}
                      borderRadius={999}
                      borderWidth={1}
                      borderColor={COLORS.ink}
                      backgroundColor={COLORS.surface}
                      alignItems="center"
                      justifyContent="center"
                      space={8}
                    >
                      {huaweiLoading ? (
                        <Spinner color={COLORS.gold} size="small" />
                      ) : null}
                      <Text fontSize={15} fontWeight="600" color={COLORS.ink}>
                        {huaweiLoading ? '正在授权…' : '华为账号登录'}
                      </Text>
                    </XStack>
                  </TouchableOpacity>
                </>
              )}

              <Text textAlign="center" fontSize={9.5} color={COLORS.faint} marginTop={12} lineHeight={15}>
                华为登录仅获取头像、昵称与 openID
              </Text>
            </YStack>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.paper,
  },
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: 32,
  },
  brandChip: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.inkWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  brandHairline: {
    marginTop: 8,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    padding: 20,
    shadowColor: COLORS.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  input: {
    height: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 15,
    color: COLORS.text,
    borderBottomWidth: 1,
  },
  passwordInput: {
    paddingRight: 30,
  },
  eyeBtn: {
    position: 'absolute',
    right: 0,
    top: 10,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPill: {
    backgroundColor: COLORS.dangerWash,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 14,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: COLORS.gold,
    backgroundColor: COLORS.gold,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 26,
    elevation: 8,
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
});
