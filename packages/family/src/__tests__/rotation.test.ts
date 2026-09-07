/**
 * 轮换计划单测
 *
 * 重点：被撤销的人必须出现在 excluded 里且拿不到新密钥；
 * 以及「剩余成员还没领完就不要废弃旧密钥」这条容易把全家锁死的规则。
 */

import { computeRotationProgress, needsRotation, planRotation, summarizeRotation } from '../rotation';
import type { MemberRecord } from '../types';

const NOW = '2026-09-08T10:00:00.000Z';

function member(userId: string, revokedAt: string | null = null): MemberRecord {
  return {
    id: `m-${userId}`,
    familyId: 'f-1',
    userId,
    displayName: userId,
    role: userId === 'u-owner' ? 'owner' : 'editor',
    joinedAt: '2026-09-01T00:00:00.000Z',
    wrappedFdk: 'wrapped',
    revokedAt,
  };
}

describe('planRotation', () => {
  it('puts active members in recipients, revoked ones in excluded', () => {
    const plan = planRotation({
      planId: 'p-1',
      familyId: 'f-1',
      members: [member('u-owner'), member('u-bob'), member('u-carol', '2026-09-08T09:00:00.000Z')],
      reason: 'member_removed',
      now: NOW,
    });
    expect(plan.recipients).toEqual(['u-owner', 'u-bob']);
    expect(plan.excluded).toEqual(['u-carol']);
  });

  it('both asset and snapshot must be re-wrapped (snapshots feed the trend chart)', () => {
    const plan = planRotation({
      planId: 'p-1', familyId: 'f-1', members: [member('u-owner')],
      reason: 'manual', now: NOW,
    });
    expect(plan.kinds).toContain('asset');
    expect(plan.kinds).toContain('snapshot');
  });

  it('handles an empty family without throwing', () => {
    const plan = planRotation({
      planId: 'p-1', familyId: 'f-1', members: [],
      reason: 'manual', now: NOW,
    });
    expect(plan.recipients).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it('keeps reason and timestamps', () => {
    const plan = planRotation({
      planId: 'p-1', familyId: 'f-1', members: [member('u-owner')],
      reason: 'device_lost', now: NOW,
    });
    expect(plan.reason).toBe('device_lost');
    expect(plan.createdAt).toBe(NOW);
  });
});

describe('computeRotationProgress', () => {
  const plan = planRotation({
    planId: 'p-1',
    familyId: 'f-1',
    members: [member('u-owner'), member('u-bob'), member('u-dave')],
    reason: 'manual',
    now: NOW,
  });

  it('starts fully pending', () => {
    const p = computeRotationProgress(plan, []);
    expect(p.pending).toEqual(['u-owner', 'u-bob', 'u-dave']);
    expect(p.claimed).toEqual([]);
    expect(p.complete).toBe(false);
  });

  it('ignores claims from non-recipients (a revoked member claiming is meaningless)', () => {
    const p = computeRotationProgress(plan, ['u-ghost', 'u-bob']);
    expect(p.claimed).toEqual(['u-bob']);
    expect(p.pending).toEqual(['u-owner', 'u-dave']);
    expect(p.complete).toBe(false);
  });

  it('completes only when every recipient claimed', () => {
    expect(computeRotationProgress(plan, ['u-owner', 'u-bob', 'u-dave']).complete).toBe(true);
  });

  it('is complete when there are no recipients at all', () => {
    const empty = planRotation({
      planId: 'p-2', familyId: 'f-1', members: [], reason: 'manual', now: NOW,
    });
    expect(computeRotationProgress(empty, []).complete).toBe(true);
  });
});

describe('needsRotation', () => {
  it('is false when nobody was revoked', () => {
    expect(needsRotation([member('u-owner'), member('u-bob')], null)).toBe(false);
  });

  it('is true when a member was revoked and never rotated', () => {
    const members = [member('u-owner'), member('u-bob', '2026-09-08T09:00:00.000Z')];
    expect(needsRotation(members, null)).toBe(true);
  });

  it('is false when the rotation happened after the revocation', () => {
    const members = [member('u-owner'), member('u-bob', '2026-09-08T09:00:00.000Z')];
    expect(needsRotation(members, '2026-09-08T09:30:00.000Z')).toBe(false);
  });

  it('is true when a newer revocation came after the last rotation', () => {
    const members = [
      member('u-owner'),
      member('u-bob', '2026-09-07T09:00:00.000Z'),
      member('u-carol', '2026-09-08T09:00:00.000Z'),
    ];
    expect(needsRotation(members, '2026-09-07T10:00:00.000Z')).toBe(true);
  });
});

describe('summarizeRotation', () => {
  it('mentions how many lose access', () => {
    const plan = planRotation({
      planId: 'p-1',
      familyId: 'f-1',
      members: [member('u-owner'), member('u-bob'), member('u-carol', NOW)],
      reason: 'member_removed',
      now: NOW,
    });
    expect(summarizeRotation(plan)).toContain('2 位成员需要更新密钥');
    expect(summarizeRotation(plan)).toContain('1 人将失去访问权限');
  });

  it('omits the loss clause when nobody is excluded', () => {
    const plan = planRotation({
      planId: 'p-1', familyId: 'f-1', members: [member('u-owner')],
      reason: 'manual', now: NOW,
    });
    expect(summarizeRotation(plan)).not.toContain('失去访问');
  });
});
