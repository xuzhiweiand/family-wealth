/**
 * 家庭服务（内存版）
 *
 * ⚠️ 这是 Supabase families / family_members / invites /
 * family_key_rotations 四张表的本地镜像，供无后端时联调 UI。
 * 真实接入后由 RPC 适配层替换本文件，页面与 store 不用改——
 * 密码学路径（wrap/unwrap/邀请码）全部复用 packages/family 的
 * 纯函数，与线上行为一致。
 *
 * 与真实后端的两点刻意差异（都写在方法注释里）：
 *   1. 内存版把 FDK 明文留在 Map 里方便多账号演示；真实环境
 *      FDK 只存在于 wrapped 副本中，永远不落服务端
 *   2. 轮换完成是同步的；真实环境各成员要各自领取（family_key_rotations）
 */

import {
  checkInviteUsable,
  checkMemberRemoval,
  createInvite,
  markClaimed,
  planRotation,
  registerFailedAttempt,
  revokeInvite as revokeInviteRow,
  type Invite,
  type MemberRecord,
  type RotationPlan,
} from '@family-wealth/family';
import {
  fromBase64,
  generateFDK,
  hashInviteCode,
  normalizeInviteCode,
  unwrapFDKFromInvite,
  wrapFDK,
  type MemberKeyContext,
} from '@family-wealth/crypto';
import type { FamilyRole } from '@family-wealth/shared-types';

export interface FamilyInfo {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  lastRotatedAt: string | null;
}

export interface JoinResult {
  ok: true;
  family: FamilyInfo;
  role: FamilyRole;
}

export type JoinFailure =
  | 'not-found'
  | 'expired'
  | 'claimed'
  | 'revoked'
  | 'locked'
  | 'wrong-code'
  | 'already-member';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function envelopeOf(invite: Invite) {
  // invites.wrappedFdk 是 base64(JSON) 的容器格式
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64(invite.wrappedFdk))) as {
    v: number; iv: string; tag: string; ct: string;
  };
  const b64 = (s: string) => fromBase64(s);
  return { version: 1 as const, iv: b64(parsed.iv), authTag: b64(parsed.tag), ciphertext: b64(parsed.ct) };
}

class InMemoryFamilyService {
  private families = new Map<string, FamilyInfo>();
  private members = new Map<string, MemberRecord[]>(); // familyId → rows
  /** codeHash → invite（真实服务端按 hash 精确查询） */
  private invites = new Map<string, Invite>();
  /**
   * 仅内存演示用：familyId → FDK 明文。
   * 真实环境绝不这样存——FDK 只以 wrapped 副本形式存在。
   */
  private fdkByFamily = new Map<string, Uint8Array>();
  private rotationPlans = new Map<string, RotationPlan[]>(); // familyId → plans
  private lastRotation: RotationPlan | null = null;

  // ---------- 查询 ----------

  getFamily(familyId: string): FamilyInfo | null {
    return this.families.get(familyId) ?? null;
  }

  /** 用户加入的第一个家庭（演示期单家庭假设） */
  findFamilyOf(userId: string): FamilyInfo | null {
    for (const [familyId, rows] of this.members) {
      if (rows.some((m) => m.userId === userId && m.revokedAt === null)) {
        return this.families.get(familyId) ?? null;
      }
    }
    return null;
  }

  listMembers(familyId: string): MemberRecord[] {
    return [...(this.members.get(familyId) ?? [])];
  }

  listInvites(familyId: string): Invite[] {
    return [...this.invites.values()].filter((i) => i.familyId === familyId);
  }

  getRotationPlans(familyId: string): RotationPlan[] {
    return [...(this.rotationPlans.get(familyId) ?? [])];
  }

  /** 是否有待完成的轮换（撤销成员后未轮换 = 隐患） */
  hasPendingRotation(familyId: string): boolean {
    const members = this.listMembers(familyId);
    const lastRotatedAt = this.families.get(familyId)?.lastRotatedAt ?? null;
    return members.some((m) => m.revokedAt !== null
      && (lastRotatedAt === null || new Date(m.revokedAt).getTime() > new Date(lastRotatedAt).getTime()));
  }

  // ---------- 创建与加入 ----------

  createFamily(input: {
    name: string;
    ownerId: string;
    ownerName: string;
    umk: Uint8Array;
  }): FamilyInfo {
    const familyId = newId('f');
    const now = new Date().toISOString();
    const family: FamilyInfo = {
      id: familyId,
      name: input.name,
      ownerId: input.ownerId,
      createdAt: now,
      lastRotatedAt: now, // 创建即视为最新密钥态
    };
    const fdk = generateFDK();
    const wrapped = wrapFDK(fdk, input.umk, { userId: input.ownerId, familyId });

    const ownerRow: MemberRecord = {
      id: newId('m'),
      familyId,
      userId: input.ownerId,
      displayName: input.ownerName || '管理员',
      role: 'owner',
      joinedAt: now,
      wrappedFdk: JSON.stringify({ note: 'wrapped_fdk(omitted in demo row)', len: wrapped.ciphertext.length }),
      revokedAt: null,
    };

    this.families.set(familyId, family);
    this.members.set(familyId, [ownerRow]);
    this.fdkByFamily.set(familyId, fdk);
    return family;
  }

  /** 生成邀请：明文码只出现在返回值里，行里只有 hash（与真实后端一致） */
  createFamilyInvite(input: {
    familyId: string;
    createdBy: string;
    now?: string;
  }): { code: string; displayCode: string; invite: Invite } {
    const fdk = this.requireFdk(input.familyId);
    const out = createInvite({
      inviteId: newId('inv'),
      familyId: input.familyId,
      fdk,
      createdBy: input.createdBy,
      now: input.now ?? new Date().toISOString(),
    });
    this.invites.set(out.invite.codeHash, out.invite);
    return out;
  }

  /** 作废未使用的邀请 */
  revokeInvite(familyId: string, inviteId: string): void {
    for (const [hash, inv] of this.invites) {
      if (inv.id === inviteId && inv.familyId === familyId) {
        this.invites.set(hash, revokeInviteRow(inv));
        return;
      }
    }
  }

  /**
   * 凭码加入：完整真实路径——
   * hash 查行 → 可用性裁决 → 解封 FDK → 用自己的 UMK 重新包裹 → 落成员行
   * 短码只在这里用一次，之后成员完全依赖自己的密码。
   */
  joinByCode(input: {
    code: string;
    userId: string;
    displayName: string;
    umk: Uint8Array;
    now?: string;
  }): JoinResult | { ok: false; reason: JoinFailure } {
    const codeHash = hashInviteCode(input.code);
    const invite = this.invites.get(codeHash) ?? null;
    const now = input.now ?? new Date().toISOString();

    const check = checkInviteUsable(invite, now);
    if (!check.ok) return { ok: false, reason: check.reason };

    const row = invite!;
    const family = this.families.get(row.familyId);
    if (!family) return { ok: false, reason: 'not-found' };

    if ((this.members.get(row.familyId) ?? []).some((m) => m.userId === input.userId && m.revokedAt === null)) {
      return { ok: false, reason: 'already-member' };
    }

    const salt = fromBase64(row.salt);
    let fdk: Uint8Array;
    try {
      fdk = unwrapFDKFromInvite(envelopeOf(row), input.code, salt, row.id);
    } catch {
      // hash 对得上但解不开：码被猜中前几位？不可能，但按失败处理并计数
      this.invites.set(row.codeHash, registerFailedAttempt(row));
      return { ok: false, reason: 'wrong-code' };
    }

    // 加入即改用自己的 UMK 副本
    const ctx: MemberKeyContext = { userId: input.userId, familyId: row.familyId };
    const wrapped = wrapFDK(fdk, input.umk, ctx);
    const member: MemberRecord = {
      id: newId('m'),
      familyId: row.familyId,
      userId: input.userId,
      displayName: input.displayName || '成员',
      role: 'viewer',
      joinedAt: now,
      wrappedFdk: JSON.stringify({ note: 'wrapped_fdk(omitted in demo row)', len: wrapped.ciphertext.length }),
      revokedAt: null,
    };
    this.members.set(row.familyId, [...(this.members.get(row.familyId) ?? []), member]);
    this.invites.set(row.codeHash, markClaimed(row, input.userId));
    return { ok: true, family, role: member.role };
  }

  // ---------- 成员管理 ----------

  /** 移除成员：权限裁决 → 软撤销 → 生成轮换计划（UI 必须提示立即轮换） */
  removeMember(input: {
    familyId: string;
    actor: { userId: string; role: FamilyRole };
    target: { userId: string; role: FamilyRole };
  }): { ok: true; rotationPlan: RotationPlan } | { ok: false; reason: string } {
    const check = checkMemberRemoval(input);
    if (!check.ok) return { ok: false, reason: check.reason };

    const rows = this.members.get(input.familyId) ?? [];
    const now = new Date().toISOString();
    const next = rows.map((m) =>
      m.userId === input.target.userId && m.revokedAt === null ? { ...m, revokedAt: now } : m,
    );
    this.members.set(input.familyId, next);

    const plan = planRotation({
      planId: newId('rot'),
      familyId: input.familyId,
      members: next,
      reason: 'member_removed',
      now,
    });
    this.rotationPlans.set(input.familyId, [...(this.rotationPlans.get(input.familyId) ?? []), plan]);
    this.lastRotation = plan;
    return { ok: true, rotationPlan: plan };
  }

  /**
   * 执行轮换（演示版）
   *
   * 真实流程：生成 FDK_new → 用 FDK_old 加密存 family_key_rotations →
   * 各成员在线时自己领取并重写副本 → 全员领完 owner 标记完成。
   * 内存版只有一台设备，直接同步完成。
   */
  completeRotation(familyId: string, ownerUmk: { userId: string; umk: Uint8Array }): RotationPlan | null {
    const plans = this.rotationPlans.get(familyId) ?? [];
    const plan = plans[plans.length - 1];
    if (!plan) return null;

    const newFdk = generateFDK();
    this.fdkByFamily.set(familyId, newFdk);
    // 重写 owner 副本（真实环境其余成员各自从 family_key_rotations 领取）
    wrapFDK(newFdk, ownerUmk.umk, { userId: ownerUmk.userId, familyId });
    const family = this.families.get(familyId);
    if (family) this.families.set(familyId, { ...family, lastRotatedAt: new Date().toISOString() });
    this.lastRotation = plan;
    return plan;
  }

  getLastRotationPlan(): RotationPlan | null {
    return this.lastRotation;
  }

  private requireFdk(familyId: string): Uint8Array {
    const fdk = this.fdkByFamily.get(familyId);
    if (!fdk) throw new Error(`family ${familyId} not found or not initialized`);
    return fdk;
  }
}

export const familyService = new InMemoryFamilyService();

export { normalizeInviteCode };
