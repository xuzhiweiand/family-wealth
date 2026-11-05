/**
 * 帮助与反馈：本地工单队列
 *
 * 反馈记录先落本机 AsyncStorage（离线也允许提交）；
 * 邮件上报见 feedback-report.ts（分离以保持本模块可在纯 Node 下单测）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const FEEDBACK_TYPES = ['数据异常', '登录/账号', '同步/备份', '功能建议', '其他'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type FeedbackStatus = 'pending' | 'resolved';

export interface FeedbackRecord {
  id: string;
  type: FeedbackType;
  content: string;
  contact: string;
  createdAt: number;
  status: FeedbackStatus;
}

export const FEEDBACK_MAX_LENGTH = 500;
const STORAGE_KEY = 'family-wealth.feedback.records';

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/** 工单号：FB-YYYYMMDD-0001（seq 从 1 开始） */
export function createFeedbackId(date: Date, seq: number): string {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`;
  return `FB-${ymd}-${pad(seq, 4)}`;
}

export function formatFeedbackDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

export function validateFeedbackContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return '请填写反馈内容';
  if (trimmed.length > FEEDBACK_MAX_LENGTH) return `反馈内容不能超过 ${FEEDBACK_MAX_LENGTH} 字`;
  return null;
}

export async function loadFeedbacks(): Promise<FeedbackRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FeedbackRecord =>
      Boolean(item && typeof item.id === 'string' && typeof item.content === 'string'));
  } catch {
    return [];
  }
}

export async function submitFeedback(input: {
  type: FeedbackType;
  content: string;
  contact: string;
}): Promise<FeedbackRecord> {
  const invalid = validateFeedbackContent(input.content);
  if (invalid) throw new Error(invalid);

  const existing = await loadFeedbacks();
  const record: FeedbackRecord = {
    id: createFeedbackId(new Date(), existing.length + 1),
    type: input.type,
    content: input.content.trim(),
    contact: input.contact.trim(),
    createdAt: Date.now(),
    status: 'pending',
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...existing]));
  return record;
}
