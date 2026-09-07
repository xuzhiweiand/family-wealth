/**
 * 家庭密钥（FDK）的生成与分发
 *
 * ── 为什么不再从 UMK 派生 FDK ────────────────────────────────
 * W2/W3 的实现是 `FDK = HKDF(UMK, familyId)`。单用户多设备没问题，
 * 但一旦引入多成员就崩了：每个成员的 UMK 由「自己的密码 + 自己的 salt」
 * 派生，互不相同 → 派生出的 FDK 也互不相同 → 谁也解不开谁的数据。
 *
 * 因此 W5 把 FDK 改为**家庭级随机密钥**：
 *   - 创建家庭时随机生成一次，此后与任何人的密码无关
 *   - 每个成员存一份「用自己 UMK 加密的 FDK 副本」（wrapped_fdk）
 *   - 改密码只需换自己那份副本，不必动 FDK、不必 re-wrap 任何业务数据
 *     （这正是原 ADR-0009 想达到但用派生做不到的事）
 *
 * 三处 AAD 各不相同，防止密文被搬到别处重放：
 *   member  → `member:${userId}:${familyId}`
 *   invite  → `invite:${inviteId}`
 *   rotation→ `rotation:${familyId}`
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { FDK_BYTES, generateRandomBytes, UMK_BYTES } from './kdf';
import { decryptEnvelope, encryptEnvelope, KEY_BYTES, wipeBytes, type EncryptedRecord } from './envelope';
import { fromBase64, toBase64 } from './encoding';

/** 邀请 KEK 的字节数 */
export const INVITE_KEK_BYTES = 32;
/** 邀请 salt 字节数（服务端存，客户端用它派生 KEK） */
export const INVITE_SALT_BYTES = 16;

export interface MemberKeyContext {
  userId: string;
  familyId: string;
}

/** 归一化邀请码：去空格与连字符、转大写（用户手抄/粘贴难免带这些） */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** 生成家庭级 FDK（随机，与任何人的密码无关） */
export function generateFDK(): Uint8Array {
  return generateRandomBytes(FDK_BYTES);
}

/** 生成邀请 salt（存服务端 invites 表，明文无害——它只是 HKDF 的 salt） */
export function generateInviteSalt(): Uint8Array {
  return generateRandomBytes(INVITE_SALT_BYTES);
}

function aadText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 成员副本的 AAD：绑定「哪个成员的、哪个家庭的」 */
export function buildMemberAad(ctx: MemberKeyContext): Uint8Array {
  return aadText(`member:${ctx.userId}:${ctx.familyId}`);
}

/** 邀请副本的 AAD */
export function buildInviteAad(inviteId: string): Uint8Array {
  return aadText(`invite:${inviteId}`);
}

/** 轮换条目的 AAD */
export function buildRotationAad(familyId: string): Uint8Array {
  return aadText(`rotation:${familyId}`);
}

function assertKey(key: Uint8Array, name: string, bytes = KEY_BYTES): void {
  if (key.length !== bytes) throw new Error(`${name} must be ${bytes} bytes, got ${key.length}`);
}

/** 用成员的 UMK 包裹 FDK（写入 family_members.wrapped_fdk） */
export function wrapFDK(fdk: Uint8Array, umk: Uint8Array, ctx: MemberKeyContext): EncryptedRecord {
  assertKey(fdk, 'fdk');
  assertKey(umk, 'umk', UMK_BYTES);
  return encryptEnvelope(fdk, umk, buildMemberAad(ctx));
}

/** 用成员的 UMK 解出 FDK；AAD 不匹配会直接抛错（防跨家庭/跨成员重放） */
export function unwrapFDK(record: EncryptedRecord, umk: Uint8Array, ctx: MemberKeyContext): Uint8Array {
  assertKey(umk, 'umk', UMK_BYTES);
  return decryptEnvelope(record, umk, buildMemberAad(ctx));
}

/**
 * 邀请码 → KEK
 *
 * ⚠️ 安全提示：6 位码只有约 30 bit 熵，拿到 wrapped_fdk + salt 的人
 * 可以离线爆破。因此熵不是主要防线，真正的防线是：
 *   ① 默认 8 位（约 39 bit）  ② 15 分钟过期  ③ 一次性使用
 *   ④ 服务端尝试次数上限  ⑤ 加入后立即改用成员 UMK 副本，短码即失效
 * 详见 ADR-0010。
 */
export function deriveInviteKEK(code: string, salt: Uint8Array, inviteId: string): Uint8Array {
  const ikm = new TextEncoder().encode(normalizeInviteCode(code));
  return hkdf(sha256, ikm, salt, aadText(`invite-kek:${inviteId}`), INVITE_KEK_BYTES);
}

/** 用邀请码包裹 FDK（写入 invites.wrapped_fdk，服务端只见密文） */
export function wrapFDKForInvite(
  fdk: Uint8Array,
  code: string,
  salt: Uint8Array,
  inviteId: string,
): EncryptedRecord {
  assertKey(fdk, 'fdk');
  const kek = deriveInviteKEK(code, salt, inviteId);
  try {
    return encryptEnvelope(fdk, kek, buildInviteAad(inviteId));
  } finally {
    wipeBytes(kek);
  }
}

/** 被邀请者用短码解出 FDK；码错一位 → GCM 校验失败抛错 */
export function unwrapFDKFromInvite(
  record: EncryptedRecord,
  code: string,
  salt: Uint8Array,
  inviteId: string,
): Uint8Array {
  const kek = deriveInviteKEK(code, salt, inviteId);
  try {
    return decryptEnvelope(record, kek, buildInviteAad(inviteId));
  } finally {
    wipeBytes(kek);
  }
}

/**
 * 邀请码的哈希（服务端索引用）
 *
 * 服务端只存 hash 不存明文，避免 DB 泄露直接拿到码。
 * 注意：短码空间小，hash 挡不住拿到 DB 的人离线爆破——所以过期与
 * 尝试次数限制必须由服务端强制执行，不能只靠这一层。
 */
export function hashInviteCode(code: string): string {
  return toBase64(sha256(new TextEncoder().encode(normalizeInviteCode(code))));
}

/** 序列化成员副本（存库用） */
export function serializeWrappedFDK(record: EncryptedRecord): string {
  return toBase64(new TextEncoder().encode(JSON.stringify({
    v: record.version,
    iv: toBase64(record.iv),
    tag: toBase64(record.authTag),
    ct: toBase64(record.ciphertext),
  })));
}

/** 反序列化成员副本 */
export function deserializeWrappedFDK(payload: string): EncryptedRecord | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64(payload)));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p['v'] !== 1) return null;
    if (typeof p['iv'] !== 'string' || typeof p['tag'] !== 'string' || typeof p['ct'] !== 'string') {
      return null;
    }
    return {
      version: 1,
      iv: fromBase64(p['iv']),
      authTag: fromBase64(p['tag']),
      ciphertext: fromBase64(p['ct']),
    };
  } catch {
    return null;
  }
}

/**
 * 轮换：用 FDK_old 加密 FDK_new，供**剩余**成员领取
 *
 * 被撤销成员没有 family_members 行了，RLS 会挡住他读这条记录，
 * 因此拿不到 FDK_new —— 这是撤销能生效的关键。
 */
export function wrapRotatedFDK(newFdk: Uint8Array, oldFdk: Uint8Array, familyId: string): EncryptedRecord {
  assertKey(newFdk, 'newFdk');
  assertKey(oldFdk, 'oldFdk');
  return encryptEnvelope(newFdk, oldFdk, buildRotationAad(familyId));
}

/** 剩余成员用自己手里的 FDK_old 领取 FDK_new */
export function unwrapRotatedFDK(record: EncryptedRecord, oldFdk: Uint8Array, familyId: string): Uint8Array {
  assertKey(oldFdk, 'oldFdk');
  return decryptEnvelope(record, oldFdk, buildRotationAad(familyId));
}
