/**
 * submit-feedback —— 用户反馈工单邮件通知
 *
 * 客户端「帮助与反馈」提交后调用本函数，服务端通过 SMTP 发送邮件到
 * FEEDBACK_TO（默认 xuzhiweiand@163.com）。
 *
 * 环境变量（使用 FEEDBACK_SMTP_* 前缀，避免覆盖 GoTrue 的全局 SMTP_* 配置）：
 *   FEEDBACK_SMTP_HOST  SMTP 服务器（163 邮箱：smtp.163.com）
 *   FEEDBACK_SMTP_PORT  SMTP 端口（SSL：465）
 *   FEEDBACK_SMTP_USER  发信账号（建议与 FEEDBACK_TO 一致）
 *   FEEDBACK_SMTP_PASS  发信授权码（163 邮箱「设置 → POP3/SMTP/IMAP → 客户端授权密码」）
 *   FEEDBACK_TO         收件邮箱，默认 xuzhiweiand@163.com
 */

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_CONTENT_LENGTH = 500;
const DEFAULT_FEEDBACK_TO = 'xuzhiweiand@163.com';

interface FeedbackPayload {
  ticketId?: string;
  type?: string;
  content?: string;
  contact?: string;
  appVersion?: string;
  platform?: string;
  userId?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function env(key: string, fallback = ''): string {
  return Deno.env.get(key) ?? fallback;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidTicketId(id: string): boolean {
  return /^FB-\d{8}-\d{4}$/.test(id);
}

/**
 * 主题由 denomailer 统一做 RFC 2047 Q 编码，这里只保证：
 * 1) 不含空格与换行（其 Q 编码不会把空格转成 `_`，会破坏 encoded-word）；
 * 2) UTF-8 字节数足够短，编码后不触发其 74 字符硬折行。
 * 因此主题固定为「家资反馈<工单号>」，详细类型与内容放在正文。
 */
function buildSubject(ticketId: string): string {
  return `家资反馈${ticketId}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let payload: FeedbackPayload;
  try {
    payload = (await req.json()) as FeedbackPayload;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const ticketId = (payload.ticketId ?? '').trim();
  const content = (payload.content ?? '').trim();
  if (!isValidTicketId(ticketId)) {
    return json({ error: '工单号格式不正确' }, 400);
  }
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return json({ error: `反馈内容需为 1–${MAX_CONTENT_LENGTH} 字` }, 400);
  }

  const smtpHost = env('FEEDBACK_SMTP_HOST', 'smtp.163.com');
  const smtpUser = env('FEEDBACK_SMTP_USER', env('SMTP_USER'));
  const smtpPass = env('FEEDBACK_SMTP_PASS', env('SMTP_PASS'));
  if (!smtpUser || !smtpPass) {
    return json({ error: '邮件服务未配置（缺少 FEEDBACK_SMTP_USER / FEEDBACK_SMTP_PASS）' }, 501);
  }

  const to = env('FEEDBACK_TO', DEFAULT_FEEDBACK_TO);
  const type = (payload.type ?? '其他').trim();
  const contact = (payload.contact ?? '未填写').trim() || '未填写';
  const platform = (payload.platform ?? 'unknown').trim();
  const appVersion = (payload.appVersion ?? 'unknown').trim();
  const userId = (payload.userId ?? '-').trim() || '-';
  const receivedAt = new Date().toISOString();

  const lines = [
    `工单号：${ticketId}`,
    `类型：${type}`,
    `联系方式：${contact}`,
    `App 版本：${appVersion}`,
    `平台：${platform}`,
    `用户 ID：${userId}`,
    `提交时间：${receivedAt}`,
    '',
    '反馈内容：',
    content,
  ];

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#111827">
      <h2 style="margin:0 0 12px;font-size:16px;color:#059669">收到一条用户反馈 ${escapeHtml(ticketId)}</h2>
      <table style="border-collapse:collapse;margin-bottom:14px">
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">类型</td><td>${escapeHtml(type)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">联系方式</td><td>${escapeHtml(contact)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">App 版本</td><td>${escapeHtml(appVersion)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">平台</td><td>${escapeHtml(platform)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">用户 ID</td><td>${escapeHtml(userId)}</td></tr>
        <tr><td style="padding:2px 10px 2px 0;color:#6B7280">提交时间</td><td>${receivedAt}</td></tr>
      </table>
      <div style="padding:12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;white-space:pre-wrap">${escapeHtml(content)}</div>
    </div>`;

  try {
    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: Number(env('FEEDBACK_SMTP_PORT', '465')),
        tls: true,
        auth: { username: smtpUser, password: smtpPass },
      },
    });
    await client.send({
      from: smtpUser,
      to,
      subject: buildSubject(ticketId),
      content: 'auto',
      html,
    });
    await client.close();
  } catch (err) {
    console.error('[submit-feedback] send failed:', (err as Error)?.message);
    return json({ error: `邮件发送失败：${(err as Error)?.message ?? '未知错误'}` }, 502);
  }

  return json({ ok: true, ticketId });
});
