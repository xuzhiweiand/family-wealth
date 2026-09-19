/**
 * 家庭共享状态
 *
 * 职责：把 family-service 的结果映射成 UI 状态。
 * 权限相关展示（能不能移除成员、要不要显示轮换横幅）全部
 * 走 packages/family 的纯函数裁决，不在 store 里手写 if。
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Invite, MemberRecord, RotationPlan } from '@family-wealth/family';
import type { FamilyRole } from '@family-wealth/shared-types';
import {
  familyService,
  type FamilyInfo,
  type JoinFailure,
} from '../services/family-service';
import { useAuthStore } from './auth-store';
import { useKeyStore } from './key-store';

export interface ActiveInvite {
  code: string;
  displayCode: string;
  expiresAt: string;
}

interface FamilyState {
  family: FamilyInfo | null;
  members: MemberRecord[];
  invites: Invite[];
  activeInvite: ActiveInvite | null;
  /** 撤销成员后尚未轮换 → UI 必须显示强提示 */
  rotationPending: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;

  /** 进入家庭页时刷新 */
  refresh: () => void;
  createFamily: (name: string) => void;
  makeInvite: () => void;
  joinByCode: (code: string) => Promise<boolean>;
  removeMember: (targetUserId: string) => void;
  rotateNow: () => void;
  clearNotice: () => void;
}

const JOIN_FAILURE_TEXT: Record<JoinFailure, string> = {
  'not-found': '邀请码不存在，请核对后重输',
  expired: '邀请已过期（有效期 15 分钟），请让家人重新生成',
  claimed: '该邀请码已被使用',
  revoked: '该邀请已被作废',
  locked: '尝试次数过多，邀请已锁定。请让家人重新生成',
  'wrong-code': '邀请码不正确',
  'already-member': '你已经是该家庭成员',
};

function myRole(members: MemberRecord[], userId: string): FamilyRole {
  return members.find((m) => m.userId === userId)?.role ?? 'viewer';
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  family: null,
  members: [],
  invites: [],
  activeInvite: null,
  rotationPending: false,
  loading: false,
  error: null,
  notice: null,

  refresh() {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const family = familyService.findFamilyOf(user.id);
    if (!family) {
      set({ family: null, members: [], invites: [], activeInvite: null, rotationPending: false });
      return;
    }
    set({
      family,
      members: familyService.listMembers(family.id),
      invites: familyService.listInvites(family.id),
      rotationPending: familyService.hasPendingRotation(family.id),
    });
  },

  createFamily(name) {
    const user = useAuthStore.getState().user;
    const umk = useKeyStore.getState().umk;
    if (!user || !umk) {
      set({ error: '缺少登录态或密钥，无法创建家庭' });
      return;
    }
    try {
      const family = familyService.createFamily({
        name: name || '我的家庭',
        ownerId: user.id,
        ownerName: user.displayName,
        umk,
      });
      // 绑定 familyId：资产录入页从 key-store 读它，否则会报"尚未解锁密钥"
      useKeyStore.getState().setUmk(umk, family.id);
      set({ family, members: familyService.listMembers(family.id), error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  makeInvite() {
    const { family } = get();
    const user = useAuthStore.getState().user;
    if (!family || !user) return;
    try {
      const out = familyService.createFamilyInvite({ familyId: family.id, createdBy: user.id });
      set({
        activeInvite: { code: out.code, displayCode: out.displayCode, expiresAt: out.invite.expiresAt },
        invites: familyService.listInvites(family.id),
      });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async joinByCode(code) {
    const user = useAuthStore.getState().user;
    const umk = useKeyStore.getState().umk;
    if (!user || !umk) {
      set({ error: '缺少登录态或密钥，无法加入' });
      return false;
    }
    set({ loading: true, error: null });
    try {
      const result = familyService.joinByCode({
        code,
        userId: user.id,
        displayName: user.displayName,
        umk,
      });
      if (!result.ok) {
        set({ loading: false, error: JOIN_FAILURE_TEXT[result.reason] });
        return false;
      }
      set({
        loading: false,
        family: result.family,
        members: familyService.listMembers(result.family.id),
        notice: `已加入「${result.family.name}」`,
      });
      // 加入家庭后同样绑定 familyId，供资产录入使用
      useKeyStore.getState().setUmk(umk, result.family.id);
      return true;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      return false;
    }
  },

  removeMember(targetUserId) {
    const { family } = get();
    const user = useAuthStore.getState().user;
    if (!family || !user) return;
    const actorRole = myRole(get().members, user.id);
    const target = get().members.find((m) => m.userId === targetUserId);
    if (!target) return;

    const result = familyService.removeMember({
      familyId: family.id,
      actor: { userId: user.id, role: actorRole },
      target: { userId: targetUserId, role: target.role },
    });
    if (!result.ok) {
      set({ error: `无法移除：${result.reason}` });
      return;
    }
    set({
      members: familyService.listMembers(family.id),
      rotationPending: familyService.hasPendingRotation(family.id),
      notice: `已移除 ${target.displayName}。请立即轮换密钥，否则其在撤销前下载的数据仍可被其解开`,
    });
  },

  rotateNow() {
    const { family } = get();
    const user = useAuthStore.getState().user;
    const umk = useKeyStore.getState().umk;
    if (!family || !user || !umk) return;
    const plan = familyService.completeRotation(family.id, { userId: user.id, umk });
    set({
      rotationPending: plan ? false : get().rotationPending,
      notice: plan ? '密钥已轮换，新的数据不再对被移除成员可见' : null,
    });
  },

  clearNotice() {
    set({ notice: null, error: null });
  },
}));

/** 当前用户在本家庭的角色（无家庭时视为 viewer） */
export function useMyFamilyRole(): FamilyRole {
  const user = useAuthStore((s) => s.user);
  const members = useFamilyStore((s) => s.members);
  // user 与 members 都是订阅态：任一变化都会重算角色，
  // 修复之前 getState() 只在渲染时读一次、user 切换不重渲染的 bug。
  return useMemo(() => myRole(members, user?.id ?? ''), [members, user?.id]);
}
