/**
 * 邀请码的生命周期
 *
 * 邀请码是「把 FDK 交给新成员」的唯一通道，也是整套方案里最薄的一环：
 * 8 位 31 进制码只有约 39 bit 熵，而 wrapped_fdk 与 salt 都躺在服务端。
 * 也就是说——**服务端（或拿到 DB 的人）具备离线爆破的能力**。
 *
 * 因此这里的所有函数都围绕「把爆炸半径压到最小」设计：
 *   - 服务端只存 hash，不存码明文
 *   - 15 分钟过期、一次性、最多 10 次尝试（由服务端强制，本模块给出裁决）
 *   - 成员一旦加入，立刻改用「自己 UMK 包裹的副本」，短码当场失效
 * 完整威胁模型见 ADR-0010。
 */

import {
  generateInviteSalt,
  generateRandomBytes,
  hashInviteCode,
  toBase64,
  wrapFDKForInvite,
} from '@family-wealth/crypto';
import {
  INVITE_CODE_LENGTH,
  INVITE_MAX_ATTEMPTS,
  INVITE_TTL_MS,
  type Invite,
  type InviteCheck,
} from './types';

/** 31 个字符：去掉 0/O/1/I/L 这五个手抄必混的 */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * 生成邀请码
 *
 * 用拒绝采样（reject b >= 248）避免取模偏置：
 * 256 = 8×31 + 8，直接 %31 会让前 8 个字符概率偏高。
 */
export function generateInviteCode(length: number = INVITE_CODE_LENGTH): string {
  if (length <= 0) throw new Error('invite code length must be positive');
  let out = '';
  while (out.length < length) {
    const buf = generateRandomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!;
      if (b < 248) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
    }
  }
  return out;
}

/** 展示用：K7M2X9AB → K7M2-X9AB（四位一断，抄写不易串行） */
export function formatInviteCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export interface CreateInviteInput {
  /** 邀请行 ID（服务端生成，同时作为 KEK 派生的 info，避免两个邀请互相通用） */
  inviteId: string;
  familyId: string;
  /** 家庭数据密钥（明文，仅在内存里） */
  fdk: Uint8Array;
  createdBy: string;
  /** 注入时间源，便于测试 */
  now: string;
  ttlMs?: number;
  codeLength?: number;
  maxAttempts?: number;
}

export interface CreateInviteOutput {
  /** 明文邀请码：只在邀请方屏幕上出现一次，绝不落库、绝不上传 */
  code: string;
  displayCode: string;
  /** 落库的那一行（只有 hash） */
  invite: Invite;
}

/** 创建邀请：生成码 → 派生 KEK → 包裹 FDK → 只把 hash 留下来 */
export function createInvite(input: CreateInviteInput): CreateInviteOutput {
  const code = generateInviteCode(input.codeLength ?? INVITE_CODE_LENGTH);
  const salt = generateInviteSalt();
  const wrapped = wrapFDKForInvite(input.fdk, code, salt, input.inviteId);
  const ttl = input.ttlMs ?? INVITE_TTL_MS;

  const invite: Invite = {
    id: input.inviteId,
    familyId: input.familyId,
    codeHash: hashInviteCode(code),
    salt: toBase64(salt),
    wrappedFdk: toBase64(new TextEncoder().encode(JSON.stringify({
      v: wrapped.version,
      iv: toBase64(wrapped.iv),
      tag: toBase64(wrapped.authTag),
      ct: toBase64(wrapped.ciphertext),
    }))),
    status: 'pending',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? INVITE_MAX_ATTEMPTS,
    expiresAt: new Date(new Date(input.now).getTime() + ttl).toISOString(),
    createdBy: input.createdBy,
    claimedBy: null,
    createdAt: input.now,
  };

  return { code, displayCode: formatInviteCode(code), invite };
}

/**
 * 这个邀请现在还能不能用
 *
 * 判定顺序有意如此：已被撤销 / 已被领取是终态，优先级高于过期；
 * 「尝试次数用尽」只在还没过期时才单独报 locked（否则用户会以为重试有用）。
 */
export function checkInviteUsable(invite: Invite | null | undefined, now: string): InviteCheck {
  if (!invite) return { ok: false, reason: 'not-found' };
  if (invite.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (invite.status === 'claimed') return { ok: false, reason: 'claimed' };
  if (invite.status === 'locked') return { ok: false, reason: 'locked' };
  if (new Date(now).getTime() > new Date(invite.expiresAt).getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (invite.attempts >= invite.maxAttempts) return { ok: false, reason: 'locked' };
  return { ok: true };
}

/** 记一次失败尝试；到达上限即锁死（返回新对象，不改入参） */
export function registerFailedAttempt(invite: Invite): Invite {
  const attempts = invite.attempts + 1;
  return {
    ...invite,
    attempts,
    status: attempts >= invite.maxAttempts ? 'locked' : invite.status,
  };
}

/** 标记已被领取（一次性：领完立即不可再用） */
export function markClaimed(invite: Invite, userId: string): Invite {
  return { ...invite, status: 'claimed', claimedBy: userId };
}

/** 主动作废（邀请方反悔） */
export function revokeInvite(invite: Invite): Invite {
  if (invite.status === 'claimed') return invite; // 已领取的不能撤销，只能移除成员
  return { ...invite, status: 'revoked' };
}

/** 估算剩余有效毫秒数（UI 倒计时用；已过期返回 0） */
export function remainingMs(invite: Invite, now: string): number {
  return Math.max(0, new Date(invite.expiresAt).getTime() - new Date(now).getTime());
}
