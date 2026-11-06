/**
 * 帮助与反馈（v0.6.0）
 *
 * 对照 v0.6.0 高保真单页「v0.6.0-support.html」复刻：
 *   沉浸墨绿 hero → 常见问题（展开 / 收起）→ 意见反馈（类型 / 内容 / 提交）
 *   → 我的反馈（历史工单与处理状态）。
 *
 * 保留原有业务：
 *   - 反馈内容先落本机工单（AsyncStorage），离线也可提交；
 *   - 再通过 reportFeedback 上报 Edge Function，失败时提示「已保存到本机」；
 *   - 联系方式默认取绑定手机号（脱敏展示）或账号邮箱，用户可修改，
 *     提交时若为合法手机号则回写本机留存；
 *   - 提交后插入「我的反馈」列表，状态徽标沿用 pending / resolved。
 */

import { COLORS, GRADIENTS, SHADOW } from '../theme';
import { SERIF_CN_TEXT } from '../typography';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import { useAppNavigation } from '../lib/navigation';
import { useAuthStore } from '../stores/auth-store';
import { getPhone, savePhone } from '../services/secure-storage';
import { maskPhone } from '../services/phone';
import { reportFeedback } from '../services/feedback-report';
import {
  FEEDBACK_MAX_LENGTH,
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

/** 设计稿：输入框计数 0 / 200（工单本身仍支持 500 字上限，取两者较小值） */
const CONTENT_MAX = Math.min(200, FEEDBACK_MAX_LENGTH);
const HERO_HEIGHT = 150;
const HERO_RADIUS = 28;

/** 展示用反馈类型；本地工单类型枚举不含「体验问题」，归入「其他」 */
type SupportType = '功能建议' | '体验问题' | '数据异常' | '其他';

const SUPPORT_TYPES: readonly SupportType[] = ['功能建议', '体验问题', '数据异常', '其他'];

const RECORD_TYPE: Record<SupportType, FeedbackType> = {
  功能建议: '功能建议',
  体验问题: '其他',
  数据异常: '数据异常',
  其他: '其他',
};

const STATUS_META: Record<
  FeedbackRecord['status'],
  { label: string; color: string; background: string }
> = {
  pending: { label: '处理中', color: COLORS.warning, background: COLORS.warningWash },
  resolved: { label: '已解决', color: COLORS.inkSoft, background: COLORS.inkWash },
};

const HERO_SUBTITLE = 'rgba(233,220,192,0.55)';
const HERO_BTN_BG = 'rgba(233,220,192,0.10)';
const HERO_BTN_LINE = 'rgba(233,220,192,0.20)';

function BackIcon() {
  return (
    <Svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke={COLORS.inkWash}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <Svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke={COLORS.goldDeep}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
    >
      <Path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

function HeroBackdrop({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={styles.heroBg} pointerEvents="none">
      <Defs>
        <LinearGradient id="supportHeroBase" x1="0.15" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor={GRADIENTS.hero[0]} />
          <Stop offset="0.46" stopColor={GRADIENTS.hero[1]} />
          <Stop offset="1" stopColor={GRADIENTS.hero[2]} />
        </LinearGradient>
        <RadialGradient
          id="supportHeroGold"
          cx="0.9"
          cy="-0.1"
          r="0.9"
          gradientUnits="objectBoundingBox"
        >
          <Stop offset="0" stopColor={COLORS.gold} stopOpacity={0.24} />
          <Stop offset="0.62" stopColor={COLORS.gold} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#supportHeroBase)" />
      <Rect x={0} y={0} width={width} height={height} fill="url(#supportHeroGold)" />
      <Circle cx={width - 34} cy={-26} r={112}
        stroke="rgba(233,220,192,0.16)" strokeWidth={1} fill="none" />
      <Circle cx={width - 4} cy={16} r={72}
        stroke="rgba(233,220,192,0.10)" strokeWidth={1} fill="none" />
      <Circle cx={width + 30} cy={48} r={46}
        stroke="rgba(233,220,192,0.07)" strokeWidth={1} fill="none" />
    </Svg>
  );
}

export default function HelpFeedbackScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);

  const [openIndex, setOpenIndex] = useState(-1);
  const [type, setType] = useState<SupportType>('数据异常');
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
    if (submitting || !content.trim()) return;
    setSubmitting(true);
    try {
      const record = await submitFeedback({
        type: RECORD_TYPE[type],
        content,
        contact,
      });
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
      setToast(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = content.trim().length > 0;
  const heroHeight = insets.top + HERO_HEIGHT;

  return (
    <View style={styles.page}>
      <StatusBar barStyle="light-content" />

      {/* 沉浸墨绿 hero：返回 + 金色小标 + 宋体标题 */}
      <View style={[styles.hero, { height: heroHeight, paddingTop: insets.top }]}>
        <HeroBackdrop width={width} height={heroHeight} />
        <View style={styles.heroInner}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="返回"
            activeOpacity={0.7}
          >
            <BackIcon />
          </TouchableOpacity>
          <Text style={styles.heroKicker}>SUPPORT</Text>
          <Text style={[styles.heroTitle, SERIF_CN_TEXT]}>帮助与反馈</Text>
          <Text style={styles.heroSubtitle}>我们会在 1 个工作日内回复</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 16 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 常见问题 */}
          <View style={[styles.card, styles.faqCard]}>
            <Text style={[styles.cardTitle, SERIF_CN_TEXT]}>常见问题</Text>
            {FAQS.map((faq, index) => {
              const open = openIndex === index;
              const last = index === FAQS.length - 1;
              return (
                <View key={faq.q} style={[styles.faqRow, last && styles.rowLast]}>
                  <TouchableOpacity
                    onPress={() => setOpenIndex(open ? -1 : index)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                  >
                    <View style={styles.faqHead}>
                      <Text style={styles.faqQuestion}>{faq.q}</Text>
                      <Chevron open={open} />
                    </View>
                  </TouchableOpacity>
                  {open ? (
                    <Text style={styles.faqAnswer}>{faq.a}</Text>
                  ) : (
                    <Text style={styles.faqPreview} numberOfLines={1}>{faq.a}</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* 意见反馈 */}
          <View style={[styles.card, styles.feedbackCard]}>
            <Text style={[styles.cardTitle, SERIF_CN_TEXT]}>意见反馈</Text>

            <View style={styles.chips}>
              {SUPPORT_TYPES.map((item) => {
                const on = item === type;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setType(item)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{item}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.inputBox}>
              <TextInput
                value={content}
                onChangeText={(text) => setContent(text.slice(0, CONTENT_MAX))}
                placeholder="说说你遇到的问题…"
                placeholderTextColor={COLORS.faint}
                multiline
                maxLength={CONTENT_MAX}
                style={styles.input}
              />
              <Text style={styles.counter}>{content.length} / {CONTENT_MAX}</Text>
            </View>

            {/* 联系方式：沿用原有「手机号或邮箱」可编辑逻辑 */}
            <View style={styles.contactRow}>
              <Text style={styles.contactLabel}>联系方式</Text>
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder="手机号或邮箱"
                placeholderTextColor={COLORS.faint}
                autoCapitalize="none"
                style={styles.contactInput}
              />
            </View>

            <TouchableOpacity
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              activeOpacity={0.88}
              accessibilityRole="button"
            >
              <Text style={styles.submitText}>{submitting ? '提交中…' : '提交反馈'}</Text>
            </TouchableOpacity>
          </View>

          {/* 我的反馈 */}
          <View style={[styles.card, styles.ticketCard]}>
            <Text style={[styles.cardTitle, SERIF_CN_TEXT]}>我的反馈</Text>
            {records.length === 0 ? (
              <Text style={styles.empty}>暂无反馈记录</Text>
            ) : (
              records.map((record, index) => {
                const meta = STATUS_META[record.status];
                const last = index === records.length - 1;
                return (
                  <View key={record.id} style={[styles.ticketRow, last && styles.rowLast]}>
                    <View style={styles.ticketMain}>
                      <Text style={styles.ticketTitle} numberOfLines={1}>
                        {record.content}
                      </Text>
                      <Text style={styles.ticketDate}>
                        {record.id} · {formatFeedbackDate(record.createdAt)}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: meta.background }]}>
                      <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <Text style={styles.footnote}>工单将在 1 个工作日内处理 · 感谢你的反馈</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {toast !== '' && (
        <View style={[styles.toastWrap, { bottom: insets.bottom + 24 }]}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.paper },
  flex: { flex: 1 },

  /* ── hero ── */
  hero: {
    backgroundColor: COLORS.ink,
    borderBottomLeftRadius: HERO_RADIUS,
    borderBottomRightRadius: HERO_RADIUS,
    overflow: 'hidden',
  },
  heroBg: { position: 'absolute', left: 0, top: 0 },
  heroInner: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HERO_BTN_BG,
    borderWidth: 1,
    borderColor: HERO_BTN_LINE,
  },
  heroKicker: {
    marginTop: 16,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 3,
    color: COLORS.gold,
  },
  heroTitle: {
    marginTop: 6,
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: 1.5,
    color: COLORS.inkWash,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.3,
    color: HERO_SUBTITLE,
  },

  /* ── 页面 ── */
  body: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 16 },

  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairlineSoft,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    ...SHADOW.card,
  },
  faqCard: { paddingBottom: 6, marginBottom: 16 },
  feedbackCard: { paddingBottom: 16, marginBottom: 16 },
  ticketCard: { paddingBottom: 6 },

  cardTitle: {
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: 0.6,
    color: COLORS.text,
    marginBottom: 8,
  },

  /* ── FAQ ── */
  faqRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  faqHead: { flexDirection: 'row', alignItems: 'center' },
  faqQuestion: { flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.text, marginRight: 12 },
  faqPreview: { marginTop: 5, fontSize: 11, lineHeight: 16, color: COLORS.faint },
  faqAnswer: { marginTop: 6, fontSize: 11, lineHeight: 18, color: COLORS.sub },

  /* ── 反馈表单 ── */
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  chipOn: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  chipText: { fontSize: 12, color: COLORS.sub },
  chipTextOn: { color: COLORS.inkWash, fontWeight: '600' },

  inputBox: {
    backgroundColor: COLORS.surfaceWarm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  input: {
    minHeight: 96,
    padding: 0,
    paddingBottom: 14,
    fontSize: 12.5,
    lineHeight: 19,
    color: COLORS.text,
    textAlignVertical: 'top',
  },
  counter: {
    position: 'absolute',
    right: 12,
    bottom: 8,
    fontSize: 10,
    color: COLORS.faint,
  },

  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surfaceWarm,
  },
  contactLabel: { fontSize: 10.5, color: COLORS.faint, marginRight: 10 },
  contactInput: { flex: 1, padding: 0, fontSize: 11.5, color: COLORS.text },

  submit: {
    height: 46,
    marginTop: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.ink,
    shadowColor: COLORS.ink,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 6,
  },
  submitDisabled: { opacity: 0.45 },
  submitText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    color: COLORS.inkWash,
  },

  /* ── 我的反馈 ── */
  empty: { paddingVertical: 18, textAlign: 'center', fontSize: 11, color: COLORS.faint },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  ticketMain: { flex: 1, marginRight: 12 },
  ticketTitle: { fontSize: 12.5, fontWeight: '600', color: COLORS.text },
  ticketDate: { marginTop: 3, fontSize: 10, color: COLORS.faint },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '600' },

  footnote: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 10,
    color: COLORS.faint,
  },

  /* ── toast ── */
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  toast: {
    backgroundColor: 'rgba(11,61,46,0.94)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: COLORS.inkDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 8,
  },
  toastText: { fontSize: 12, fontWeight: '500', color: COLORS.inkWash },
});
