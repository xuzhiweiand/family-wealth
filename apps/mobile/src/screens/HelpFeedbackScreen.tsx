/**
 * 帮助与反馈（v0.5.0）
 *
 * - 常见问题：本地静态 FAQ
 * - 提交反馈：类型 + 描述（500 字）+ 联系方式，生成本地工单号
 * - 我的反馈：本机记录与处理状态
 */

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button, Spinner, Text, XStack, YStack } from 'tamagui';
import { useAppNavigation } from '../lib/navigation';
import { useAuthStore } from '../stores/auth-store';
import { getPhone, savePhone } from '../services/secure-storage';
import { maskPhone } from '../services/phone';
import { reportFeedback } from '../services/feedback-report';
import {
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_TYPES,
  formatFeedbackDate,
  loadFeedbacks,
  submitFeedback,
  type FeedbackRecord,
  type FeedbackType,
} from '../services/feedback-store';

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: '为什么我的数据在另一台手机上打不开？',
    a: '数据密钥只保存在首次登录的设备与本机备份中。换机请先在旧设备「我的 → 本地备份」生成加密备份包，在新设备登录后通过「本地备份 → 恢复」导入；仅登录同一账号不会自动同步密钥。',
  },
  {
    q: '当月净资产为什么和上月不一致？',
    a: '首页按「当月有快照」的口径统计：只计入本月提交过余额的资产，每笔取当月最新一条。若当月没有提交，会回退到最近一次有数据的月份，并标注「数据截至」。',
  },
  {
    q: '华为账号登录后，原来的邮箱账号还在吗？',
    a: '华为账号是独立身份，不会合并到已有邮箱账号。若需继续使用原家庭数据，请在「我的 → 账号 → 绑定手机号」完成绑定后，用原账号登录并邀请新账号加入家庭。',
  },
  {
    q: '提醒没有按时弹出怎么办？',
    a: '请在系统设置中允许「家资管理工具」发送通知与读取日历；鸿蒙端提醒写入系统日历，关闭日历权限会导致提醒不显示。',
  },
];

function BackIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth={2.2} strokeLinecap="round">
      <Path d="M15 19l-7-7 7-7" />
    </Svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <Svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#9CA3AF"
      strokeWidth={2}
      strokeLinecap="round"
      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
    >
      <Path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export default function HelpFeedbackScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const [openIndex, setOpenIndex] = useState(0);
  const [type, setType] = useState<FeedbackType>('数据异常');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    void (async () => {
      setRecords(await loadFeedbacks());
      const phone = await getPhone();
      setContact(phone ? maskPhone(phone) : (user?.email ?? ''));
    })();
  }, [user?.email]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const record = await submitFeedback({ type, content, contact });
      setRecords((prev) => [record, ...prev]);
      setContent('');
      // 本地已落库，再尝试发送邮件到开发者邮箱
      const report = await reportFeedback(record, user?.id);
      setToast(
        report.ok
          ? `已提交，工单号 ${record.id}`
          : `已保存到本机，邮件发送失败：${report.error ?? '未知原因'}`,
      );
      // 若联系方式是绑定手机号，确保本机留存（用户可能在此修改）
      if (/^1[3-9]\d{9}$/.test(contact.trim())) {
        await savePhone(contact.trim());
      }
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <View style={{ height: insets.top, backgroundColor: '#F9FAFB' }} />
      <XStack
        height={52}
        alignItems="center"
        paddingHorizontal="$md"
        borderBottomColor="$border"
        borderBottomWidth={1}
        backgroundColor="#F9FAFB"
      >
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={{ width: 32 }}>
          <BackIcon />
        </TouchableOpacity>
        <YStack flex={1}>
          <Text fontSize={16} fontWeight="700" color="$textPrimary" textAlign="center">
            帮助与反馈
          </Text>
          <Text fontSize={10} color="$textTertiary" textAlign="center">
            工作日 1–2 天内回复 · 工单可追踪
          </Text>
        </YStack>
        <View style={{ width: 32 }} />
      </XStack>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Text fontSize={10.5} color="$textTertiary" fontWeight="600" marginBottom="$sm" marginLeft={4}>
            常见问题
          </Text>
          <YStack backgroundColor="white" borderRadius="$lg" borderColor="$border" borderWidth={1} overflow="hidden">
            {FAQS.map((faq, index) => {
              const open = openIndex === index;
              return (
                <YStack
                  key={faq.q}
                  borderBottomColor={index === FAQS.length - 1 ? 'transparent' : '#F3F4F6'}
                  borderBottomWidth={index === FAQS.length - 1 ? 0 : 1}
                >
                  <TouchableOpacity
                    onPress={() => setOpenIndex(open ? -1 : index)}
                    activeOpacity={0.7}
                  >
                    <XStack paddingHorizontal="$md" height={48} alignItems="center" space="$sm">
                      <Text flex={1} fontSize={12.5} color="$textPrimary">{faq.q}</Text>
                      <Chevron open={open} />
                    </XStack>
                  </TouchableOpacity>
                  {open && (
                    <Text
                      paddingHorizontal="$md"
                      paddingBottom="$sm"
                      fontSize={10.5}
                      lineHeight={18}
                      color="$textSecondary"
                    >
                      {faq.a}
                    </Text>
                  )}
                </YStack>
              );
            })}
          </YStack>

          <Text fontSize={10.5} color="$textTertiary" fontWeight="600" marginTop="$lg" marginBottom="$sm" marginLeft={4}>
            没找到答案？提交反馈
          </Text>
          <YStack backgroundColor="white" borderRadius="$lg" borderColor="$border" borderWidth={1} padding="$md">
            <XStack flexWrap="wrap" gap={6} marginBottom="$sm">
              {FEEDBACK_TYPES.map((item) => {
                const on = item === type;
                return (
                  <TouchableOpacity key={item} onPress={() => setType(item)} activeOpacity={0.7}>
                    <View style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                      borderWidth: 1, borderColor: on ? '#10B981' : '#E5E7EB',
                      backgroundColor: on ? '#ECFDF5' : 'white',
                    }}>
                      <Text fontSize={10.5} color={on ? '#047857' : '#6B7280'} fontWeight={on ? '700' : '400'}>
                        {item}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </XStack>

            <View style={{
              borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB',
              backgroundColor: '#F9FAFB', padding: 10,
            }}>
              <TextInput
                value={content}
                onChangeText={(text) => setContent(text.slice(0, FEEDBACK_MAX_LENGTH))}
                placeholder="请描述遇到的问题：在哪一步、看到什么、期望是什么"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                maxLength={FEEDBACK_MAX_LENGTH}
                style={{
                  minHeight: 76, fontSize: 12, lineHeight: 19, color: '#111827',
                  textAlignVertical: 'top', padding: 0,
                }}
              />
              <Text fontSize={9.5} color="$textTertiary" textAlign="right" marginTop={4}>
                {content.length}/{FEEDBACK_MAX_LENGTH}
              </Text>
            </View>

            <XStack alignItems="center" space="$sm" marginTop="$sm">
              <Text fontSize={10} color="$textSecondary">联系方式</Text>
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder="手机号或邮箱"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                style={{ flex: 1, fontSize: 11, color: '#374151', paddingVertical: 2 }}
              />
            </XStack>

            <Button
              height={42}
              fontSize={13}
              fontWeight="700"
              marginTop="$md"
              backgroundColor="$primary"
              color="white"
              onPress={handleSubmit}
              disabled={submitting || !content.trim()}
              opacity={content.trim() ? 1 : 0.4}
              {...(submitting ? { icon: <Spinner color="white" /> } : {})}
            >
              {submitting ? '提交中...' : '提交反馈'}
            </Button>
            <Text fontSize={9.5} color="$textTertiary" textAlign="center" marginTop="$xs">
              提交后会生成工单号，可在下方查看处理进度
            </Text>
          </YStack>

          <Text fontSize={10.5} color="$textTertiary" fontWeight="600" marginTop="$lg" marginBottom="$sm" marginLeft={4}>
            我的反馈
          </Text>
          <YStack backgroundColor="white" borderRadius="$lg" borderColor="$border" borderWidth={1} overflow="hidden">
            {records.length === 0 ? (
              <Text fontSize={11} color="$textTertiary" padding="$lg" textAlign="center">
                还没有提交过反馈
              </Text>
            ) : (
              records.map((record, index) => (
                <XStack
                  key={record.id}
                  paddingHorizontal="$md"
                  paddingVertical="$sm"
                  alignItems="flex-start"
                  space="$sm"
                  borderBottomColor={index === records.length - 1 ? 'transparent' : '#F3F4F6'}
                  borderBottomWidth={index === records.length - 1 ? 0 : 1}
                >
                  <YStack flex={1}>
                    <Text fontSize={11.5} color="$textPrimary" numberOfLines={1}>
                      {record.type} · {record.content}
                    </Text>
                    <Text fontSize={9.5} color="$textTertiary" marginTop={3}>
                      {record.id} · {formatFeedbackDate(record.createdAt)}
                    </Text>
                  </YStack>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                    backgroundColor: record.status === 'resolved' ? '#ECFDF5' : '#FFFBEB',
                  }}>
                    <Text fontSize={9.5} color={record.status === 'resolved' ? '#047857' : '#B45309'}>
                      {record.status === 'resolved' ? '已解决' : '待处理'}
                    </Text>
                  </View>
                </XStack>
              ))
            )}
          </YStack>
        </ScrollView>
      </KeyboardAvoidingView>

      {toast !== '' && (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 72,
          alignItems: 'center', pointerEvents: 'none',
        }}>
          <View style={{
            backgroundColor: 'rgba(17,24,39,0.92)', paddingHorizontal: 14, paddingVertical: 8,
            borderRadius: 999,
          }}>
            <Text fontSize={11} fontWeight="600" color="white">{toast}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
