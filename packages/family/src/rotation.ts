/**
 * 撤销成员后的密钥轮换
 *
 * 先说清楚这套方案做不到什么（别自欺欺人）：
 *   撤销成员 **不能** 让他已经下载到本地的旧密文失效——端到端加密下，
 *   服务端没有能力远程擦除别人设备上的数据。这是设计上的固有代价。
 *
 * 能做到的是：**让他从此拿不到 FDK_new**。
 *   - 服务端删掉他的 family_members 行 → RLS 挡住他读 family_key_rotations
 *   - Owner 用 FDK_old 加密 FDK_new 存服务端，只有仍是成员的人能领
 *   - 剩余成员领到后，用自己的 UMK 重新包一份副本，旧 FDK 即可废弃
 *
 * 一个容易漏的产品细节：如果剩余成员一直不在线，FDK_new 就一直没人领。
 * 所以 `computeRotationProgress` 会给出 pending 名单，UI 必须催——
 * 否则 owner 一清缓存，全家人都打不开数据。
 */

import type { MemberRecord, RotationPlan, RotationProgress, RotationReason } from './types';

export interface PlanRotationInput {
  planId: string;
  familyId: string;
  /** 当前所有成员（含已撤销的，本函数会自行过滤） */
  members: readonly MemberRecord[];
  reason: RotationReason;
  now: string;
}

/** 生成轮换计划：谁该领新密钥、谁被排除、哪些记录要 re-wrap */
export function planRotation(input: PlanRotationInput): RotationPlan {
  const active = input.members.filter((m) => m.revokedAt === null);
  const revoked = input.members.filter((m) => m.revokedAt !== null);

  return {
    id: input.planId,
    familyId: input.familyId,
    reason: input.reason,
    // 快照是 append-only 且量大，但它是趋势图唯一数据源，必须一起 re-wrap
    kinds: ['asset', 'snapshot'],
    recipients: active.map((m) => m.userId),
    excluded: revoked.map((m) => m.userId),
    createdAt: input.now,
  };
}

/** 谁还没领 FDK_new —— 全员领完之前，旧 FDK 不能废弃 */
export function computeRotationProgress(
  plan: RotationPlan,
  claimed: readonly string[],
): RotationProgress {
  const claimedSet = new Set(claimed);
  const pending = plan.recipients.filter((u) => !claimedSet.has(u));
  return {
    planId: plan.id,
    claimed: plan.recipients.filter((u) => claimedSet.has(u)),
    pending,
    // 一个 recipient 都没有（比如家庭只剩 owner 且 owner 自己保管）时视为完成
    complete: pending.length === 0,
  };
}

/** 这个家庭现在需不需要轮换？有成员被撤销就算需要 */
export function needsRotation(members: readonly MemberRecord[], lastRotatedAt: string | null): boolean {
  const revoked = members.filter((m) => m.revokedAt !== null);
  if (revoked.length === 0) return false;
  if (lastRotatedAt === null) return true;
  const last = new Date(lastRotatedAt).getTime();
  // 只要有任何一次撤销发生在上次轮换之后，就要再轮换
  return revoked.some((m) => new Date(m.revokedAt!).getTime() > last);
}

/** 给 UI 的人话摘要 */
export function summarizeRotation(plan: RotationPlan): string {
  const reasonText: Record<RotationReason, string> = {
    member_removed: '成员已移除',
    manual: '手动轮换',
    device_lost: '设备丢失',
  };
  const n = plan.recipients.length;
  const excluded = plan.excluded.length;
  const tail = excluded > 0 ? `，${excluded} 人将失去访问权限` : '';
  return `${reasonText[plan.reason]}：${n} 位成员需要更新密钥${tail}`;
}
