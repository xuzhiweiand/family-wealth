/**
 * 手机号绑定 / 更换底部弹层
 *
 * 短信验证码走 Supabase Phone OTP（updateUser → verifyOtp）；
 * 绑定成功后同时写入本机 Keychain，供「我的」页展示脱敏号码。
 */

import { COLORS } from '../theme';
import { FONT, SERIF_CN_TEXT } from '../typography';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Button, Spinner, Text, XStack, YStack } from 'tamagui';
import { getAuthClient } from '@family-wealth/api';
import { isValidPhone, maskPhone } from '../services/phone';
import { savePhone } from '../services/secure-storage';

interface Props {
  visible: boolean;
  currentPhone: string | null;
  onClose: () => void;
  onSaved: (phone: string) => void;
}

const INPUT_STYLE = {
  flex: 1,
  fontSize: 13,
  color: COLORS.text,
  paddingVertical: 0,
} as const;

export function PhoneBindingSheet({ visible, currentPhone, onClose, onSaved }: Props) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      setPhone(currentPhone ?? '');
      setCode('');
      setError(null);
      setCountdown(0);
    }
  }, [visible, currentPhone]);

  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => {
      setCountdown((v) => Math.max(0, v - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [countdown > 0]);

  const handleSendCode = async () => {
    if (sending || countdown > 0) return;
    if (!isValidPhone(phone)) {
      setError('请输入正确的 11 位手机号');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const result = await getAuthClient().sendPhoneBindingCode(phone);
      if (!result.ok) {
        setError(result.error?.message ?? '验证码发送失败');
        return;
      }
      setCountdown(60);
      if (result.data?.devCode) {
        // 本地兜底实现（无短信网关）直接回填，便于联调
        setCode(result.data.devCode);
        Alert.alert('验证码已发送', `开发模式验证码：${result.data.devCode}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!isValidPhone(phone)) {
      setError('请输入正确的 11 位手机号');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await getAuthClient().confirmPhoneBinding(phone, code);
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? '验证码校验失败');
        return;
      }
      await savePhone(phone);
      onSaved(phone);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(7,42,31,0.48)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
          <YStack backgroundColor={COLORS.surface} borderTopLeftRadius={24} borderTopRightRadius={24} padding="$lg" paddingBottom={32}>
            <View style={{
              width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.hairline,
              alignSelf: 'center', marginBottom: 12,
            }} />
            <XStack alignItems="center" marginBottom="$xs">
              <Text flex={1} fontSize={15} fontWeight="700" color={COLORS.text} style={SERIF_CN_TEXT} letterSpacing={0.6}>
                {currentPhone ? '更换手机号' : '绑定手机号'}
              </Text>
              <Text fontSize={11} color={COLORS.faint} onPress={onClose}>取消</Text>
            </XStack>
            <Text fontSize={10.5} color="$textSecondary" marginBottom="$md" lineHeight={17}>
              用于账号找回与家庭邀请，仅你自己与家庭成员可见脱敏后的号码。
            </Text>

            <YStack space="$sm">
              <XStack
                height={48} borderRadius={14} borderWidth={1} borderColor={COLORS.hairline}
                backgroundColor={COLORS.paper} paddingHorizontal={12} alignItems="center" space="$sm"
              >
                <Text fontSize={12} fontWeight="600" color={COLORS.sub}>+86</Text>
                <View style={{ width: 1, height: 16, backgroundColor: COLORS.hairline }} />
                <TextInput
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入 11 位手机号"
                  placeholderTextColor={COLORS.faint}
                  keyboardType="phone-pad"
                  maxLength={11}
                  style={INPUT_STYLE}
                />
              </XStack>

              <XStack
                height={48} borderRadius={14} borderWidth={1} borderColor={COLORS.hairline}
                backgroundColor={COLORS.paper} paddingHorizontal={12} alignItems="center" space="$sm"
              >
                <TextInput
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位验证码"
                  placeholderTextColor={COLORS.faint}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={INPUT_STYLE}
                />
                <TouchableOpacity onPress={handleSendCode} disabled={sending || countdown > 0}>
                  <View style={{
                    height: 30, paddingHorizontal: 10, borderRadius: 8,
                    backgroundColor: countdown > 0 ? COLORS.divider : COLORS.inkWash,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {sending ? (
                      <Spinner color={COLORS.inkSoft} size="small" />
                    ) : (
                      <Text fontSize={10.5} color={countdown > 0 ? COLORS.faint : COLORS.inkSoft} fontWeight="600">
                        {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              </XStack>
            </YStack>

            {error && (
              <Text fontSize={10.5} color="$debt" marginTop="$sm">{error}</Text>
            )}

            {currentPhone && (
              <Text fontSize={10} color="$textTertiary" marginTop="$sm">
                当前绑定：{maskPhone(currentPhone)}
              </Text>
            )}

            <Button
              height={46}
              fontSize={14}
              fontWeight="700"
              marginTop="$md"
              backgroundColor="$primary"
              color={COLORS.surface}
              onPress={handleSave}
              disabled={saving || !isValidPhone(phone) || !/^\d{6}$/.test(code)}
              opacity={isValidPhone(phone) && /^\d{6}$/.test(code) ? 1 : 0.4}
              {...(saving ? { icon: <Spinner color={COLORS.surface} /> } : {})}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
            <Text fontSize={10} color="$textTertiary" textAlign="center" marginTop="$xs">
              需先完成短信验证；一个手机号最多绑定 3 个账号
            </Text>
          </YStack>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
