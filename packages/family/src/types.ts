/**
 * 家庭共享领域类型
 *
 * 对齐《数据模型设计.md》v1.0 与 ADR-0010。
 * 这里的每一行都对应 supabase/migrations/20260908000000_family_sharing.sql 的表。
 */

import type { FamilyRole, Visibility } from '@family-wealth/shared-types';

/** 邀请码默认长度。8 位 ≈ 39 bit（31 进制），是「手抄可用性」与「防误入」的折中 */
export const INVITE_CODE_LENGTH = 8;
/** 邀请有效期。短码熵有限，过期是第一道防线 */
export const INVITE_TTL_MS = 15 * 60 * 1000;
/** 单个邀请的最大尝试次数。超过即锁死——短码扛不住离线爆破，只能靠限流 */
export const INVITE_MAX_ATTEMPTS = 10;

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

/** family_members 表的一行 */
export interface MemberRecord {
  id: string;
  familyId: string;
  userId: string;
  displayName: string;
  role: FamilyRole;
  joinedAt: string;
  /**
   * 用「该成员自己的 UMK」加密的 FDK 副本（base64 envelope）
   * 服务端只见密文；成员每次登录凭自己的密码解出 FDK
   */
  wrappedFdk: string;
  /** 软删：撤销后仍留痕，用于审计与轮换判定 */
  revokedAt: string | null;
}

export type InviteStatus = 'pending' | 'claimed' | 'expired' | 'revoked' | 'locked';

/** invites 表的一行（注意：不含邀请码明文） */
export interface Invite {
  id: string;
  familyId: string;
  /** SHA256(归一化后的邀请码)，服务端索引用；DB 泄露也不直接给出码 */
  codeHash: string;
  /** HKDF salt（base64）。明文存无害，它只是派生 KEK 的 salt */
  salt: string;
  /** 用邀请码派生的 KEK 加密的 FDK（base64 envelope） */
  wrappedFdk: string;
  status: InviteStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  createdBy: string;
  claimedBy: string | null;
  createdAt: string;
}

/** 邀请不可用的原因（UI 要分别给不同提示） */
export type InviteRejection = 'not-found' | 'revoked' | 'claimed' | 'expired' | 'locked';

export type InviteCheck = { ok: true } | { ok: false; reason: InviteRejection };

/** 轮换原因 */
export type RotationReason = 'member_removed' | 'manual' | 'device_lost';

/**
 * 轮换计划
 *
 * 撤销成员本身不能让「他已经下载到本地的旧密文」失效，
 * 但能让他拿不到 FDK_new —— 从此新数据他读不了。
 */
export interface RotationPlan {
  id: string;
  familyId: string;
  reason: RotationReason;
  /** 需要 re-wrap 的记录类型（与 packages/sync 的 SyncKind 对齐） */
  kinds: readonly ('asset' | 'snapshot')[];
  /** 应该领到 FDK_new 的成员（已排除被撤销者） */
  recipients: readonly string[];
  /** 拿不到 FDK_new 的人 */
  excluded: readonly string[];
  createdAt: string;
}

export interface RotationProgress {
  planId: string;
  claimed: readonly string[];
  pending: readonly string[];
  /** 全部剩余成员都领到了 —— 此时旧 FDK 才能安全废弃 */
  complete: boolean;
}

/** 资产级访问的判定上下文 */
export interface AssetAccessContext {
  role: FamilyRole;
  visibility: Visibility;
  /** 该资产是否由当前用户创建 */
  isOwn: boolean;
}

export type AssetAction = 'view' | 'edit' | 'delete';

export type RoleChangeRejection =
  | 'not-owner'
  | 'target-is-owner'
  | 'self-demotion'
  | 'same-role';

export type MemberRemovalRejection = 'not-owner' | 'target-is-owner' | 'self-removal';
