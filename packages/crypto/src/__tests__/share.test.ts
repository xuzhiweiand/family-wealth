/**
 * 家庭密钥分发单测
 *
 * 重点验证三件事：
 *   1. 不同成员的 UMK 不同，但拿到的 FDK 必须完全一致（多成员能互相解密的前提）
 *   2. AAD 错位（跨成员 / 跨家庭 / 跨邀请）必须解密失败，不能静默给出错误密钥
 *   3. 邀请码哪怕只差一位也解不开 —— 否则限流就是形同虚设
 */

import {
  deserializeWrappedFDK,
  generateFDK,
  generateInviteSalt,
  hashInviteCode,
  normalizeInviteCode,
  serializeWrappedFDK,
  unwrapFDK,
  unwrapFDKFromInvite,
  unwrapRotatedFDK,
  wrapFDK,
  wrapFDKForInvite,
  wrapRotatedFDK,
} from '../share';
import { constantTimeEqual, deriveUMK, generateSalt, UMK_BYTES } from '../kdf';

const FAMILY = 'f-1';
const ALICE = 'u-alice';
const BOB = 'u-bob';

function umkOf(password: string, seed: number): Uint8Array {
  const salt = generateSalt();
  // 用 seed 微调 salt，模拟「每个人的 salt 不同」
  for (let i = 0; i < salt.length; i++) salt[i] = (salt[i]! + seed) % 256;
  return deriveUMK(password, salt);
}

describe('generateFDK', () => {
  it('produces 32 random bytes', () => {
    const a = generateFDK();
    const b = generateFDK();
    expect(a).toHaveLength(32);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe('member wrapped_fdk', () => {
  it('two members with different UMKs recover the SAME fdk', () => {
    const fdk = generateFDK();
    const umkAlice = umkOf('alice-pw', 1);
    const umkBobby = umkOf('bob-pw-完全不同', 2);
    expect(constantTimeEqual(umkAlice, umkBobby)).toBe(false);

    const wrapAlice = wrapFDK(fdk, umkAlice, { userId: ALICE, familyId: FAMILY });
    const wrapBob = wrapFDK(fdk, umkBobby, { userId: BOB, familyId: FAMILY });

    expect(constantTimeEqual(unwrapFDK(wrapAlice, umkAlice, { userId: ALICE, familyId: FAMILY }), fdk)).toBe(true);
    expect(constantTimeEqual(unwrapFDK(wrapBob, umkBobby, { userId: BOB, familyId: FAMILY }), fdk)).toBe(true);
    // 关键：两人解出来的必须是同一个 FDK
    expect(
      constantTimeEqual(
        unwrapFDK(wrapAlice, umkAlice, { userId: ALICE, familyId: FAMILY }),
        unwrapFDK(wrapBob, umkBobby, { userId: BOB, familyId: FAMILY }),
      ),
    ).toBe(true);
  });

  it('refuses to unwrap another member copy (AAD binds userId)', () => {
    const fdk = generateFDK();
    const umk = umkOf('pw', 1);
    const rec = wrapFDK(fdk, umk, { userId: ALICE, familyId: FAMILY });
    expect(() => unwrapFDK(rec, umk, { userId: BOB, familyId: FAMILY })).toThrow(/decryption failed/i);
  });

  it('refuses to unwrap across families (AAD binds familyId)', () => {
    const fdk = generateFDK();
    const umk = umkOf('pw', 1);
    const rec = wrapFDK(fdk, umk, { userId: ALICE, familyId: FAMILY });
    expect(() => unwrapFDK(rec, umk, { userId: ALICE, familyId: 'f-2' })).toThrow(/decryption failed/i);
  });

  it('fails with a wrong password (UMK mismatch)', () => {
    const fdk = generateFDK();
    const salt = generateSalt();
    const rec = wrapFDK(fdk, deriveUMK('correct horse', salt), { userId: ALICE, familyId: FAMILY });
    expect(() => unwrapFDK(rec, deriveUMK('wrong horse', salt), { userId: ALICE, familyId: FAMILY })).toThrow();
  });

  it('round-trips through the DB string form', () => {
    const fdk = generateFDK();
    const umk = umkOf('pw', 1);
    const ctx = { userId: ALICE, familyId: FAMILY };
    const wire = serializeWrappedFDK(wrapFDK(fdk, umk, ctx));
    expect(typeof wire).toBe('string');
    const rec = deserializeWrappedFDK(wire);
    expect(rec).not.toBeNull();
    expect(constantTimeEqual(unwrapFDK(rec!, umk, ctx), fdk)).toBe(true);
  });

  it('returns null for garbage payload instead of throwing', () => {
    expect(deserializeWrappedFDK('not-base64!!!')).toBeNull();
    expect(deserializeWrappedFDK('')).toBeNull();
  });

  it('rejects wrong UMK length early', () => {
    const fdk = generateFDK();
    expect(() => wrapFDK(fdk, new Uint8Array(8), { userId: ALICE, familyId: FAMILY })).toThrow(/umk must be/);
    expect(UMK_BYTES).toBe(32);
  });
});

describe('invite code', () => {
  const inviteId = 'inv-1';

  it('normalizes user input (spaces, dashes, lowercase)', () => {
    expect(normalizeInviteCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeInviteCode('aB3k-9m')).toBe('AB3K9M');
  });

  it('same code + salt + inviteId ⇒ same KEK ⇒ decryptable', () => {
    const fdk = generateFDK();
    const salt = generateInviteSalt();
    const code = 'K7M2X9AB';
    const rec = wrapFDKForInvite(fdk, code, salt, inviteId);
    expect(constantTimeEqual(unwrapFDKFromInvite(rec, code, salt, inviteId), fdk)).toBe(true);
  });

  it('one-character-off code cannot decrypt', () => {
    const fdk = generateFDK();
    const salt = generateInviteSalt();
    const rec = wrapFDKForInvite(fdk, 'K7M2X9AB', salt, inviteId);
    expect(() => unwrapFDKFromInvite(rec, 'K7M2X9AC', salt, inviteId)).toThrow(/decryption failed/i);
  });

  it('wrong inviteId (AAD) cannot decrypt even with the right code', () => {
    const fdk = generateFDK();
    const salt = generateInviteSalt();
    const rec = wrapFDKForInvite(fdk, 'K7M2X9AB', salt, inviteId);
    expect(() => unwrapFDKFromInvite(rec, 'K7M2X9AB', salt, 'inv-2')).toThrow(/decryption failed/i);
  });

  it('wrong salt cannot decrypt', () => {
    const fdk = generateFDK();
    const rec = wrapFDKForInvite(fdk, 'K7M2X9AB', generateInviteSalt(), inviteId);
    expect(() => unwrapFDKFromInvite(rec, 'K7M2X9AB', generateInviteSalt(), inviteId)).toThrow(/decryption failed/i);
  });

  it('tolerates lowercase / dashed input thanks to normalization', () => {
    const fdk = generateFDK();
    const salt = generateInviteSalt();
    const rec = wrapFDKForInvite(fdk, 'K7M2X9AB', salt, inviteId);
    expect(constantTimeEqual(unwrapFDKFromInvite(rec, 'k7m2-x9ab', salt, inviteId), fdk)).toBe(true);
  });
});

describe('hashInviteCode', () => {
  it('is stable and normalizes before hashing', () => {
    expect(hashInviteCode('ABCDEF')).toBe(hashInviteCode('ab-cd ef'));
  });

  it('produces 32-byte (44-char base64) digests', () => {
    const h = hashInviteCode('K7M2X9AB');
    expect(h).toHaveLength(44);
    expect(h).not.toContain('K7M2');
  });

  it('different codes rarely collide (sampled)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(hashInviteCode(`CODE${i}`));
    expect(seen.size).toBe(500);
  });
});

describe('rotation handoff', () => {
  it('remaining members claim FDK_new with FDK_old', () => {
    const oldFdk = generateFDK();
    const newFdk = generateFDK();
    const rec = wrapRotatedFDK(newFdk, oldFdk, FAMILY);
    expect(constantTimeEqual(unwrapRotatedFDK(rec, oldFdk, FAMILY), newFdk)).toBe(true);
  });

  it('cannot be claimed with the wrong family AAD', () => {
    const rec = wrapRotatedFDK(generateFDK(), generateFDK(), FAMILY);
    expect(() => unwrapRotatedFDK(rec, generateFDK(), 'f-other')).toThrow(/decryption failed/i);
  });

  it('cannot be claimed by someone holding an unrelated key', () => {
    const rec = wrapRotatedFDK(generateFDK(), generateFDK(), FAMILY);
    expect(() => unwrapRotatedFDK(rec, generateFDK(), FAMILY)).toThrow(/decryption failed/i);
  });
});
