/**
 * 邀请码单测
 *
 * 除了常规生命周期，重点验证两件「安全上必须成立」的事：
 *   1. 落库的 invite 行里绝不出现邀请码明文（漏了就是 E2E 破防）
 *   2. 尝试次数到顶必须锁死、过期必须失效（短码扛不住爆破，只能靠这个）
 */

import {
  INVITE_ALPHABET,
  checkInviteUsable,
  createInvite,
  formatInviteCode,
  generateInviteCode,
  markClaimed,
  registerFailedAttempt,
  remainingMs,
  revokeInvite,
} from '../invite';
import { INVITE_CODE_LENGTH, type Invite } from '../types';
import { generateFDK, hashInviteCode, normalizeInviteCode, unwrapFDKFromInvite } from '@family-wealth/crypto';

const NOW = '2026-09-08T10:00:00.000Z';
const FAMILY = 'f-1';

function makeInvite(over: Partial<Invite> = {}): Invite {
  return {
    id: 'inv-1',
    familyId: FAMILY,
    codeHash: 'x'.repeat(44),
    salt: 'c2FsdA==',
    wrappedFdk: 'not-a-real-envelope',
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    expiresAt: '2026-09-08T10:15:00.000Z',
    createdBy: 'u-owner',
    claimedBy: null,
    createdAt: NOW,
    ...over,
  };
}

describe('generateInviteCode', () => {
  it('defaults to 8 chars', () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  it('respects explicit length', () => {
    expect(generateInviteCode(6)).toHaveLength(6);
    expect(generateInviteCode(12)).toHaveLength(12);
  });

  it('rejects non-positive length', () => {
    expect(() => generateInviteCode(0)).toThrow(/positive/);
  });

  it('never emits look-alike characters (0/O/1/I/L)', () => {
    // 抽样 300 个码，易混字符出现次数必须为 0（这是硬约束，不是概率问题）
    const sample = Array.from({ length: 300 }, () => generateInviteCode()).join('');
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(sample).not.toContain(ch);
    }
  });

  it('uses the full alphabet (no modulo bias starvation)', () => {
    // 300 个 8 位码 ≈ 2400 字符，31 个字符每个期望出现约 77 次；
    // 若存在取模偏置，尾部字符会系统性偏少。这里只做粗粒度护栏。
    const sample = Array.from({ length: 300 }, () => generateInviteCode()).join('');
    const counts = new Map<string, number>();
    for (const ch of sample) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(INVITE_ALPHABET.length);
    for (const ch of INVITE_ALPHABET) {
      expect(counts.get(ch) ?? 0).toBeGreaterThan(20);
    }
  });

  it('is random, not a fixed sequence', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(set.size).toBe(200);
  });
});

describe('formatInviteCode', () => {
  it('groups into 4-char chunks', () => {
    expect(formatInviteCode('K7M2X9AB')).toBe('K7M2-X9AB');
    expect(formatInviteCode('K7M2')).toBe('K7M2');
    expect(formatInviteCode('')).toBe('');
  });
});

describe('createInvite', () => {
  it('returns a code and a row that contains NO plaintext code', () => {
    const fdk = generateFDK();
    const out = createInvite({
      inviteId: 'inv-1',
      familyId: FAMILY,
      fdk,
      createdBy: 'u-owner',
      now: NOW,
    });
    expect(out.code).toHaveLength(8);
    expect(out.displayCode).toBe(formatInviteCode(out.code));

    // 关键：整行序列化后不得出现邀请码
    const serialized = JSON.stringify(out.invite);
    expect(serialized).not.toContain(out.code);
    // 存的必须是 hash
    expect(out.invite.codeHash).toBe(hashInviteCode(out.code));
  });

  it('wraps the real FDK (invitee can unwrap with the code)', () => {
    const fdk = generateFDK();
    const out = createInvite({
      inviteId: 'inv-1', familyId: FAMILY, fdk, createdBy: 'u-owner', now: NOW,
    });
    // 复刻成员侧的解封路径
    const parsed = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(out.invite.wrappedFdk), (c) => c.charCodeAt(0)),
    )) as { v: number; iv: string; tag: string; ct: string };
    const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const rec = {
      version: parsed.v as 1,
      iv: b64(parsed.iv),
      authTag: b64(parsed.tag),
      ciphertext: b64(parsed.ct),
    };
    const saltBytes = b64(out.invite.salt);
    const got = unwrapFDKFromInvite(rec, out.code, saltBytes, 'inv-1');
    expect(Buffer.from(got).toString('hex')).toBe(Buffer.from(fdk).toString('hex'));
  });

  it('honors custom ttl and maxAttempts', () => {
    const out = createInvite({
      inviteId: 'inv-1', familyId: FAMILY, fdk: generateFDK(),
      createdBy: 'u-owner', now: NOW, ttlMs: 60_000, maxAttempts: 5,
    });
    expect(out.invite.maxAttempts).toBe(5);
    expect(new Date(out.invite.expiresAt).getTime() - new Date(NOW).getTime()).toBe(60_000);
  });

  it('a second invite with the same id still gets a different code/salt', () => {
    const fdk = generateFDK();
    const a = createInvite({ inviteId: 'inv-1', familyId: FAMILY, fdk, createdBy: 'u', now: NOW });
    const b = createInvite({ inviteId: 'inv-1', familyId: FAMILY, fdk, createdBy: 'u', now: NOW });
    expect(a.code).not.toBe(b.code);
    expect(a.invite.salt).not.toBe(b.invite.salt);
  });
});

describe('checkInviteUsable', () => {
  it('accepts a fresh pending invite', () => {
    expect(checkInviteUsable(makeInvite(), NOW)).toEqual({ ok: true });
  });

  it('reports not-found for null', () => {
    expect(checkInviteUsable(null, NOW)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports expired past expiresAt', () => {
    const inv = makeInvite({ expiresAt: '2026-09-08T09:59:59.000Z' });
    expect(checkInviteUsable(inv, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('locks once attempts hit the cap', () => {
    const inv = makeInvite({ attempts: 3, maxAttempts: 3 });
    expect(checkInviteUsable(inv, NOW)).toEqual({ ok: false, reason: 'locked' });
  });

  it('terminal states win over expiry', () => {
    const past = { expiresAt: '2026-09-08T09:00:00.000Z' };
    expect(checkInviteUsable(makeInvite({ ...past, status: 'claimed' }), NOW)).toEqual({ ok: false, reason: 'claimed' });
    expect(checkInviteUsable(makeInvite({ ...past, status: 'revoked' }), NOW)).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('registerFailedAttempt', () => {
  it('increments and locks at the cap', () => {
    let inv = makeInvite({ attempts: 0, maxAttempts: 2 });
    inv = registerFailedAttempt(inv);
    expect(inv.attempts).toBe(1);
    expect(inv.status).toBe('pending');
    inv = registerFailedAttempt(inv);
    expect(inv.attempts).toBe(2);
    expect(inv.status).toBe('locked');
  });

  it('does not mutate the input', () => {
    const inv = makeInvite({ attempts: 0 });
    registerFailedAttempt(inv);
    expect(inv.attempts).toBe(0);
  });
});

describe('markClaimed / revokeInvite', () => {
  it('markClaimed records the user and closes the invite', () => {
    const inv = markClaimed(makeInvite(), 'u-bob');
    expect(inv.status).toBe('claimed');
    expect(inv.claimedBy).toBe('u-bob');
    expect(checkInviteUsable(inv, NOW).ok).toBe(false);
  });

  it('revokeInvite is a no-op once claimed (must remove the member instead)', () => {
    const claimed = markClaimed(makeInvite(), 'u-bob');
    expect(revokeInvite(claimed).status).toBe('claimed');
  });

  it('revokeInvite works while pending', () => {
    expect(revokeInvite(makeInvite()).status).toBe('revoked');
  });
});

describe('remainingMs', () => {
  it('counts down and floors at 0', () => {
    expect(remainingMs(makeInvite(), NOW)).toBe(15 * 60 * 1000);
    expect(remainingMs(makeInvite({ expiresAt: '2026-09-08T09:00:00.000Z' }), NOW)).toBe(0);
  });
});

describe('normalizeInviteCode integration', () => {
  it('invitee can paste lowercase with dashes', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(formatInviteCode(code).toLowerCase())).toBe(code);
  });
});
