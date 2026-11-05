/**
 * 反馈工单上报：调用 Supabase Edge Function `submit-feedback`，
 * 由服务端通过 SMTP 发送到开发者邮箱（默认 xuzhiweiand@163.com）。
 */

import { Platform } from 'react-native';
import { supabaseConfig } from './supabase';
import type { FeedbackRecord } from './feedback-store';

/** 与 apps/mobile/package.json version 保持一致 */
const APP_VERSION = '0.5.0';

export interface FeedbackReportResult {
  ok: boolean;
  error: string | undefined;
}

export async function reportFeedback(
  record: FeedbackRecord,
  userId: string | undefined,
): Promise<FeedbackReportResult> {
  const { url, anonKey } = supabaseConfig;
  if (!url || !anonKey) {
    return { ok: false, error: '未配置反馈服务地址' };
  }
  try {
    const res = await fetch(`${url}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        ticketId: record.id,
        type: record.type,
        content: record.content,
        contact: record.contact,
        appVersion: APP_VERSION,
        platform: Platform.OS,
        userId,
      }),
    });
    const text = await res.text();
    let body: { error?: string; ok?: boolean } | null = null;
    try {
      body = JSON.parse(text) as { error?: string; ok?: boolean } | null;
    } catch {
      body = null;
    }
    if (!res.ok || body?.error) {
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, error: undefined };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? '网络异常' };
  }
}
