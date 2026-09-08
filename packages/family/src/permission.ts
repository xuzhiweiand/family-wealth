/**
 * 三级角色权限裁决（纯函数，服务端与客户端共用同一份判定）
 *
 * 原则：
 *   - 权限判定必须是纯函数且不依赖网络，这样 UI 能在离线时立刻禁用按钮，
 *     而不是等服务端返回 403 才报错
 *   - 服务端仍要再校验一次（RLS + policy），客户端判定只是 UX，不是安全边界
 *
 * 两个刻意「反直觉」的设计：
 *   1. 删除他人资产需要 owner —— editor 能改但不能删。财务数据删错的代价
 *      远高于改错的代价（改错能改回来，删错了要靠软删恢复流程）
 *   2. 只有 owner 能邀请成员 —— 防止 editor 把权限扩散出去
 */

import type { Asset, FamilyRole, Visibility } from '@family-wealth/shared-types';
import type { AssetAccessContext, AssetAction, MemberRemovalRejection, RoleChangeRejection } from './types';

export type Capability =
  | 'view_family_assets'
  | 'view_members'
  | 'create_asset'
  | 'invite_member'
  | 'remove_member'
  | 'change_role'
  | 'rotate_family_key';

const OWNER_CAPABILITIES: readonly Capability[] = [
  'view_family_assets',
  'view_members',
  'create_asset',
  'invite_member',
  'remove_member',
  'change_role',
  'rotate_family_key',
];

const EDITOR_CAPABILITIES: readonly Capability[] = [
  'view_family_assets',
  'view_members',
  'create_asset',
];

const VIEWER_CAPABILITIES: readonly Capability[] = ['view_family_assets', 'view_members'];

const MATRIX: Record<FamilyRole, ReadonlySet<Capability>> = {
  owner: new Set(OWNER_CAPABILITIES),
  editor: new Set(EDITOR_CAPABILITIES),
  viewer: new Set(VIEWER_CAPABILITIES),
};

/** 该角色是否拥有某项能力 */
export function can(role: FamilyRole, capability: Capability): boolean {
  return MATRIX[role]?.has(capability) ?? false;
}

/**
 * 对某条具体资产能不能做某个动作
 *
 * 判断顺序：owner 通吃 → 他人的 private 资产一律挡（除 owner）→ viewer 只读
 *           → editor 可改不可删他人资产
 */
export function canDoOnAsset(ctx: AssetAccessContext, action: AssetAction): boolean {
  const { role, visibility, isOwn } = ctx;
  if (role === 'owner') return true;
  // private 资产只对创建者本人与 owner 可见
  if (visibility === 'private' && !isOwn) return false;
  if (role === 'viewer') return action === 'view';
  // editor
  if (action === 'delete' && !isOwn) return false;
  return true;
}

/**
 * 列表场景：当前用户能看到哪些资产？
 *
 * 等价于「canDoOnAsset(ctx, 'view')」按资产批量过滤。
 * 这是 mobile 仪表盘 + 趋势聚合的可见口径——私有资产不计入家庭净资产（产品决策 W6 phase 3）。
 */
export function filterVisibleAssets(
  assets: readonly Asset[],
  viewerUserId: string,
  role: FamilyRole,
): Asset[] {
  return assets.filter((a) =>
    canDoOnAsset({ role, visibility: a.visibility, isOwn: a.ownerId === viewerUserId }, 'view'),
  );
}

/**
 * 给上层 UI 用的「能不能创建私有资产」判定。
 * 直接复用 can(role, 'create_asset')，但显式命名让意图自描述——viewer 不该看到那个开关。
 */
export function canCreatePrivateAsset(role: FamilyRole): boolean {
  return can(role, 'create_asset');
}

/** 角色 + 资产 visibility 的展示文案（UI 标签用） */
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  family: '家庭共享',
  private: '仅自己可见',
};

export interface RoleChangeInput {
  actor: { userId: string; role: FamilyRole };
  target: { userId: string; role: FamilyRole };
  nextRole: FamilyRole;
}

export type RoleChangeCheck = { ok: true } | { ok: false; reason: RoleChangeRejection };

/**
 * 能不能把 target 的角色改成 nextRole
 *
 * 拦三种会把自己或家庭锁死的操作：
 *   - 只有 owner 能改角色
 *   - owner 自己的角色不能被改（否则可能没人能管理家庭）
 *   - owner 不能把自己降级（否则家庭变成无人管理）
 */
export function checkRoleChange(input: RoleChangeInput): RoleChangeCheck {
  const { actor, target, nextRole } = input;
  if (actor.role !== 'owner') return { ok: false, reason: 'not-owner' };
  if (target.role === 'owner') return { ok: false, reason: 'target-is-owner' };
  if (actor.userId === target.userId && nextRole !== 'owner') {
    return { ok: false, reason: 'self-demotion' };
  }
  if (target.role === nextRole) return { ok: false, reason: 'same-role' };
  return { ok: true };
}

export interface MemberRemovalInput {
  actor: { userId: string; role: FamilyRole };
  target: { userId: string; role: FamilyRole };
}

export type MemberRemovalCheck = { ok: true } | { ok: false; reason: MemberRemovalRejection };

/**
 * 能不能移除 target
 *
 * 判定顺序：self-removal 最先——无论操作者是谁，「移除自己」都应引导到
 * 「退出家庭」流程（owner 退出还涉及转让所有权，是完全不同的路径），
 * 给笼统的权限错误反而让用户无路可走。
 */
export function checkMemberRemoval(input: MemberRemovalInput): MemberRemovalCheck {
  const { actor, target } = input;
  if (actor.userId === target.userId) return { ok: false, reason: 'self-removal' };
  if (actor.role !== 'owner') return { ok: false, reason: 'not-owner' };
  if (target.role === 'owner') return { ok: false, reason: 'target-is-owner' };
  return { ok: true };
}

/** 角色中文名（UI 展示） */
export const ROLE_LABELS: Record<FamilyRole, string> = {
  owner: '管理员',
  editor: '编辑者',
  viewer: '查看者',
};
