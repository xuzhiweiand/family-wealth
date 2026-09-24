/**
 * Supabase 家庭网关（真实后端实现）
 *
 * 与 InMemoryFamilyService 同一套使用表面（family-store 按云端开关二选一）。
 * 对接 supabase/migrations：
 *   - create_family / claim_invite / finalize_join / remove_member /
 *     start_rotation / claim_rotation / complete_rotation 七个 RPC
 *   - invites 行由 owner 经 RLS 直接 insert（"owner manages invites"）
 *
 * 所有密钥操作（wrap/unwrap FDK、邀请解封、轮换领取）复用
 * packages/crypto 与 packages/family 纯函数，与服务端校验字节级对齐。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Invite, MemberRecord, RotationPlan } from '@family-wealth/family';
import {
  createInvite,
  needsRotation,
} from '@family-wealth/family';
import type { EncryptedRecord } from '@family-wealth/crypto';
import {
  fromBase64,
  generateFDK,
  serializeWrappedFDK,
  deserializeWrappedFDK,
  unwrapFDK,
  unwrapFDKFromInvite,
  unwrapRotatedFDK,
  wrapFDK,
  wrapRotatedFDK,
} from '@family-wealth/crypto';
import type { FamilyRole } from '@family-wealth/shared-types';
import { supabase } from './supabase';
import { uuid } from '../lib/uuid';
import type { FamilyInfo, JoinFailure } from './family-service';

// ---------- 服务端行类型（只声明用到的列） ----------

interface FamilyRow {
  id: string;
  name: string;
  owner_id: string;
  last_rotated_at: string | null;
  created_at: string;
}

interface MemberRow {
  id: string;
  family_id: string;
  user_id: string;
  display_name: string;
  role: FamilyRole;
  wrapped_fdk: string;
  revoked_at: string | null;
  joined_at: string;
}

interface InviteRow {
  id: string;
  family_id: string;
  code_hash: string;
  salt: string;
  wrapped_fdk: string;
  status: Invite['status'];
  attempts: number;
  max_attempts: number;
  expires_at: string;
  created_by: string;
  claimed_by: string | null;
  created_at: string;
}

interface RotationRow {
  id: string;
  family_id: string;
  reason: RotationPlan['reason'];
  wrapped_new_fdk: string;
  created_at: string;
  completed_at: string | null;
}

interface ClaimInviteResult {
  invite_id: string;
  family_id: string;
  family_name: string;
  salt: string;
  wrapped_fdk: string;
}

// ---------- 入参/出参 ----------

export interface CreateFamilyInput {
  name: string;
  ownerId: string;
  ownerName: string;
  umk: Uint8Array;
}

export interface CreateInviteInput {
  familyId: string;
  createdBy: string;
  fdk: Uint8Array;
}

export interface JoinByCodeInput {
  code: string;
  userId: string;
  displayName: string;
  umk: Uint8Array;
}

function toFamilyInfo(r: FamilyRow): FamilyInfo {
  return {
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    lastRotatedAt: r.last_rotated_at,
  };
}

function toMemberRecord(r: MemberRow): MemberRecord {
  return {
    id: r.id,
    familyId: r.family_id,
    userId: r.user_id,
    displayName: r.display_name,
    role: r.role,
    wrappedFdk: r.wrapped_fdk,
    joinedAt: r.joined_at,
    revokedAt: r.revoked_at,
  };
}

function toInvite(r: InviteRow): Invite {
  return {
    id: r.id,
    familyId: r.family_id,
    codeHash: r.code_hash,
    salt: r.salt,
    wrappedFdk: r.wrapped_fdk,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    expiresAt: r.expires_at,
    createdBy: r.created_by,
    claimedBy: r.claimed_by,
    createdAt: r.created_at,
  };
}

/** 容器 base64（JSON{v,iv,tag,ct}）→ EncryptedRecord */
function containerToRecord(b64: string): EncryptedRecord {
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64(b64))) as {
    v: number; iv: string; tag: string; ct: string;
  };
  return {
    version: 1,
    iv: fromBase64(parsed.iv),
    authTag: fromBase64(parsed.tag),
    ciphertext: fromBase64(parsed.ct),
  };
}

/** RPC 异常 code → JoinFailure（找不到映射时 null） */
function mapJoinError(message: string): JoinFailure | null {
  const code = message.replace(/^.*\((.*)\).*$/, '$1').trim();
  switch (message) {
    case 'invite-not-found':
      return 'not-found';
    case 'invite-expired':
      return 'expired';
    case 'invite-claimed':
      return 'claimed';
    case 'invite-revoked':
      return 'revoked';
    case 'invite-locked':
    case 'rate-limited':
      return 'locked';
    case 'already-member':
      return 'already-member';
    default:
      if (code && code !== message) return mapJoinError(code);
      return null;
  }
}

class SupabaseFamilyGateway {
  constructor(private readonly client: SupabaseClient) {}

  // ---------- 查询 ----------

  async findFamilyOf(userId: string): Promise<FamilyInfo | null> {
    const { data, error } = await this.client
      .from('family_members')
      .select('family_id, families ( id, name, owner_id, last_rotated_at, created_at )')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as unknown as
      | { family_id: string; families: FamilyRow | null }
      | undefined;
    return row?.families ? toFamilyInfo(row.families) : null;
  }

  async listMembers(familyId: string): Promise<MemberRecord[]> {
    const { data, error } = await this.client
      .from('family_members')
      .select('*')
      .eq('family_id', familyId)
      .is('revoked_at', null);
    if (error) throw new Error(error.message);
    return ((data ?? []) as MemberRow[]).map(toMemberRecord);
  }

  async listInvites(familyId: string): Promise<Invite[]> {
    const { data, error } = await this.client
      .from('invites')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as InviteRow[]).map(toInvite);
  }

  async hasPendingRotation(familyId: string): Promise<boolean> {
    const { data: familyData, error: fErr } = await this.client
      .from('families')
      .select('last_rotated_at')
      .eq('id', familyId)
      .single();
    if (fErr) throw new Error(fErr.message);

    const { data: revoked, error: mErr } = await this.client
      .from('family_members')
      .select('revoked_at')
      .eq('family_id', familyId)
      .not('revoked_at', 'is', null);
    if (mErr) throw new Error(mErr.message);

    const members = (revoked ?? []).map((r) => ({
      revokedAt: (r as { revoked_at: string }).revoked_at,
    })) as Pick<MemberRecord, 'revokedAt'>[];
    return needsRotation(members as MemberRecord[], familyData!.last_rotated_at);
  }

  // ---------- 创建家庭 ----------

  async createFamily(input: CreateFamilyInput): Promise<{ family: FamilyInfo; fdk: Uint8Array }> {
    const familyId = uuid();
    const fdk = generateFDK();
    const ownerWrapped = serializeWrappedFDK(
      wrapFDK(fdk, input.umk, { userId: input.ownerId, familyId }),
    );

    const { error } = await this.client.rpc('create_family', {
      p_name: input.name,
      p_wrapped_fdk: ownerWrapped,
      p_display_name: input.ownerName,
      p_family_id: familyId,
    });
    if (error) throw new Error(error.message);

    const now = new Date().toISOString();
    return {
      family: {
        id: familyId,
        name: input.name,
        ownerId: input.ownerId,
        createdAt: now,
        lastRotatedAt: now,
      },
      fdk,
    };
  }

  // ---------- 邀请 ----------

  async createFamilyInvite(input: CreateInviteInput): Promise<{
    code: string; displayCode: string; expiresAt: string;
  }> {
    const inviteId = uuid();
    const now = new Date().toISOString();
    const out = createInvite({
      inviteId,
      familyId: input.familyId,
      fdk: input.fdk,
      createdBy: input.createdBy,
      now,
    });

    const { error } = await this.client.from('invites').insert({
      family_id: input.familyId,
      code_hash: out.invite.codeHash,
      salt: out.invite.salt,
      wrapped_fdk: out.invite.wrappedFdk,
      status: 'pending',
      max_attempts: out.invite.maxAttempts,
      expires_at: out.invite.expiresAt,
      created_by: input.createdBy,
    });
    if (error) throw new Error(error.message);

    return { code: out.code, displayCode: out.displayCode, expiresAt: out.invite.expiresAt };
  }

  // ---------- 凭码加入 ----------

  async joinByCode(input: JoinByCodeInput): Promise<
    { ok: true; family: FamilyInfo; fdk: Uint8Array; role: FamilyRole }
    | { ok: false; reason: JoinFailure }
  > {
    let claim: ClaimInviteResult[] | null;
    const { data: claimData, error: claimErr } = await this.client.rpc(
      'claim_invite',
      { p_code: input.code },
    );
    if (claimErr) {
      const reason = mapJoinError(claimErr.message);
      return { ok: false, reason: reason ?? 'wrong-code' };
    }
    claim = (claimData ?? []) as ClaimInviteResult[];
    const row = claim[0];
    if (!row) return { ok: false, reason: 'not-found' };

    let fdk: Uint8Array;
    try {
      const record = containerToRecord(row.wrapped_fdk);
      const salt = fromBase64(row.salt);
      fdk = unwrapFDKFromInvite(record, input.code, salt, row.invite_id);
    } catch {
      return { ok: false, reason: 'wrong-code' };
    }

    const memberWrapped = serializeWrappedFDK(
      wrapFDK(fdk, input.umk, { userId: input.userId, familyId: row.family_id }),
    );
    const { error: finErr } = await this.client.rpc('finalize_join', {
      p_invite_id: row.invite_id,
      p_wrapped_fdk: memberWrapped,
      p_display_name: input.displayName,
    });
    if (finErr) {
      const reason = mapJoinError(finErr.message);
      return { ok: false, reason: reason ?? 'wrong-code' };
    }

    // 已成为成员，拉取完整家庭信息
    const { data: fam, error: famErr } = await this.client
      .from('families')
      .select('*')
      .eq('id', row.family_id)
      .single();
    if (famErr) throw new Error(famErr.message);

    return {
      ok: true,
      family: toFamilyInfo(fam as FamilyRow),
      fdk,
      role: 'viewer',
    };
  }

  // ---------- 移除成员 ----------

  async removeMember(familyId: string, targetUserId: string): Promise<
    { ok: true; remaining: number } | { ok: false; reason: string }
  > {
    const { data, error } = await this.client.rpc('remove_member', {
      p_family_id: familyId,
      p_target_user_id: targetUserId,
    });
    if (error) return { ok: false, reason: error.message };
    return { ok: true, remaining: (data as number) ?? 0 };
  }

  // ---------- 手动轮换（owner 一键，含自领取/尝试关闭） ----------

  async completeRotation(input: {
    familyId: string;
    userId: string;
    umk: Uint8Array;
    fdkOld: Uint8Array;
  }): Promise<{ ok: true; fdk: Uint8Array }> {
    const newFdk = generateFDK();
    const rotationWrapped = serializeWrappedFDK(
      wrapRotatedFDK(newFdk, input.fdkOld, input.familyId),
    );

    const { error: startErr } = await this.client.rpc('start_rotation', {
      p_family_id: input.familyId,
      p_wrapped_new_fdk: rotationWrapped,
      p_reason: 'manual',
    });
    if (startErr) throw new Error(startErr.message);

    // owner 自领取
    const ownerWrapped = serializeWrappedFDK(
      wrapFDK(newFdk, input.umk, { userId: input.userId, familyId: input.familyId }),
    );
    const { error: claimErr } = await this.client.rpc('claim_rotation', {
      p_family_id: input.familyId,
      p_wrapped_fdk: ownerWrapped,
    });
    if (claimErr) throw new Error(claimErr.message);

    // 家庭内只有 owner 时立即完成；有待领取成员则保持开放，
    // 各成员下次 refresh 时经 recoverKeys 自动领取
    const { error: compErr } = await this.client.rpc('complete_rotation', {
      p_family_id: input.familyId,
    });
    if (compErr && compErr.message !== 'pending-members') throw new Error(compErr.message);

    return { ok: true, fdk: newFdk };
  }

  // ---------- 登录后恢复 FDK（含自动领取开放轮换） ----------

  async recoverKeys(input: {
    familyId: string;
    userId: string;
    umk: Uint8Array;
  }): Promise<{ fdk: Uint8Array }> {
    const { data: row, error } = await this.client
      .from('family_members')
      .select('wrapped_fdk')
      .eq('family_id', input.familyId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error('member row missing');

    const memberRecord = deserializeWrappedFDK(
      (row as { wrapped_fdk: string }).wrapped_fdk,
    );
    if (!memberRecord) throw new Error('wrapped fdk malformed');
    let fdk = unwrapFDK(memberRecord, input.umk, {
      userId: input.userId,
      familyId: input.familyId,
    });

    // 自动领取未完成轮换（其他成员发起、我尚未更新的场景）
    const { data: rotations, error: rotErr } = await this.client
      .from('family_key_rotations')
      .select('*')
      .eq('family_id', input.familyId)
      .is('completed_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (rotErr) throw new Error(rotErr.message);

    const open = (rotations ?? [])[0] as RotationRow | undefined;
    if (open) {
      const rotationRecord = deserializeWrappedFDK(open.wrapped_new_fdk);
      if (rotationRecord) {
        const newFdk = unwrapRotatedFDK(rotationRecord, fdk, input.familyId);
        const myWrapped = serializeWrappedFDK(
          wrapFDK(newFdk, input.umk, { userId: input.userId, familyId: input.familyId }),
        );
        const { error: claimErr } = await this.client.rpc('claim_rotation', {
          p_family_id: input.familyId,
          p_wrapped_fdk: myWrapped,
        });
        if (!claimErr) fdk = newFdk;

        // owner 顺带尝试关闭（pending-members 时保持开放）
        const { data: family } = await this.client
          .from('families')
          .select('owner_id')
          .eq('id', input.familyId)
          .single();
        if ((family as { owner_id: string } | null)?.owner_id === input.userId) {
          const { error: compErr } = await this.client.rpc('complete_rotation', {
            p_family_id: input.familyId,
          });
          if (compErr && compErr.message !== 'pending-members') {
            throw new Error(compErr.message);
          }
        }
      }
    }

    return { fdk };
  }
}

export const familyGateway: SupabaseFamilyGateway | null = supabase
  ? new SupabaseFamilyGateway(supabase)
  : null;
