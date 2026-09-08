/**
 * 权限裁决单测
 *
 * 重点覆盖三条「会把自己锁死」或「会毁数据」的规则：
 *   - owner 不能被改角色、不能被移除（否则家庭无人管理）
 *   - owner 不能把自己降级
 *   - editor 能改但不能删他人资产（删错要靠软删恢复，代价高）
 */

import {
  ROLE_LABELS,
  VISIBILITY_LABELS,
  can,
  canCreatePrivateAsset,
  canDoOnAsset,
  checkMemberRemoval,
  checkRoleChange,
  filterVisibleAssets,
} from '../permission';
import type { FamilyRole, Visibility } from '@family-wealth/shared-types';
import type { AssetAccessContext } from '../types';

describe('can (role → capability)', () => {
  it('owner has every capability', () => {
    const caps = [
      'view_family_assets', 'view_members', 'create_asset',
      'invite_member', 'remove_member', 'change_role', 'rotate_family_key',
    ] as const;
    for (const c of caps) expect(can('owner', c)).toBe(true);
  });

  it('editor can create but cannot manage members or rotate keys', () => {
    expect(can('editor', 'create_asset')).toBe(true);
    expect(can('editor', 'view_members')).toBe(true);
    expect(can('editor', 'invite_member')).toBe(false);
    expect(can('editor', 'remove_member')).toBe(false);
    expect(can('editor', 'change_role')).toBe(false);
    expect(can('editor', 'rotate_family_key')).toBe(false);
  });

  it('viewer is read-only', () => {
    expect(can('viewer', 'view_family_assets')).toBe(true);
    expect(can('viewer', 'view_members')).toBe(true);
    expect(can('viewer', 'create_asset')).toBe(false);
  });
});

describe('canDoOnAsset', () => {
  function ctx(role: FamilyRole, visibility: Visibility, isOwn: boolean): AssetAccessContext {
    return { role, visibility, isOwn };
  }

  it('owner can do anything, including others private assets', () => {
    expect(canDoOnAsset(ctx('owner', 'private', false), 'view')).toBe(true);
    expect(canDoOnAsset(ctx('owner', 'private', false), 'edit')).toBe(true);
    expect(canDoOnAsset(ctx('owner', 'private', false), 'delete')).toBe(true);
  });

  it('nobody but owner can touch another member private asset', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canDoOnAsset(ctx(role, 'private', false), 'view')).toBe(false);
      expect(canDoOnAsset(ctx(role, 'private', false), 'edit')).toBe(false);
      expect(canDoOnAsset(ctx(role, 'private', false), 'delete')).toBe(false);
    }
  });

  it('own private asset is always accessible', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canDoOnAsset(ctx(role, 'private', true), 'view')).toBe(true);
    }
    expect(canDoOnAsset(ctx('editor', 'private', true), 'delete')).toBe(true);
  });

  it('viewer is read-only on shared assets', () => {
    expect(canDoOnAsset(ctx('viewer', 'family', false), 'view')).toBe(true);
    expect(canDoOnAsset(ctx('viewer', 'family', false), 'edit')).toBe(false);
    expect(canDoOnAsset(ctx('viewer', 'family', false), 'delete')).toBe(false);
  });

  it('editor can edit others shared assets but not delete them', () => {
    expect(canDoOnAsset(ctx('editor', 'family', false), 'edit')).toBe(true);
    expect(canDoOnAsset(ctx('editor', 'family', false), 'delete')).toBe(false);
  });

  it('editor can delete own assets', () => {
    expect(canDoOnAsset(ctx('editor', 'family', true), 'delete')).toBe(true);
  });
});

describe('checkRoleChange', () => {
  const owner = { userId: 'u-owner', role: 'owner' as FamilyRole };
  const bob = { userId: 'u-bob', role: 'viewer' as FamilyRole };

  it('allows owner to promote a viewer', () => {
    expect(checkRoleChange({ actor: owner, target: bob, nextRole: 'editor' })).toEqual({ ok: true });
  });

  it('blocks non-owner', () => {
    const editor = { userId: 'u-ed', role: 'editor' as FamilyRole };
    expect(checkRoleChange({ actor: editor, target: bob, nextRole: 'editor' }))
      .toEqual({ ok: false, reason: 'not-owner' });
  });

  it('blocks changing the owner role', () => {
    expect(checkRoleChange({ actor: owner, target: owner, nextRole: 'viewer' }))
      .toEqual({ ok: false, reason: 'target-is-owner' });
  });

  it('blocks owner demoting themselves (would orphan the family)', () => {
    expect(checkRoleChange({ actor: owner, target: owner, nextRole: 'viewer' }))
      .toEqual({ ok: false, reason: 'target-is-owner' });
    // 即便 target 不是 owner，actor 给自己降级也要拦
    const selfAsEditor = { userId: 'u-x', role: 'owner' as FamilyRole };
    expect(checkRoleChange({ actor: selfAsEditor, target: { userId: 'u-x', role: 'editor' }, nextRole: 'viewer' }))
      .toEqual({ ok: false, reason: 'self-demotion' });
  });

  it('blocks a no-op change', () => {
    expect(checkRoleChange({ actor: owner, target: bob, nextRole: 'viewer' }))
      .toEqual({ ok: false, reason: 'same-role' });
  });
});

describe('checkMemberRemoval', () => {
  const owner = { userId: 'u-owner', role: 'owner' as FamilyRole };
  const bob = { userId: 'u-bob', role: 'editor' as FamilyRole };

  it('allows owner to remove an editor', () => {
    expect(checkMemberRemoval({ actor: owner, target: bob })).toEqual({ ok: true });
  });

  it('blocks non-owner', () => {
    const viewer = { userId: 'u-v', role: 'viewer' as FamilyRole };
    expect(checkMemberRemoval({ actor: viewer, target: bob }))
      .toEqual({ ok: false, reason: 'not-owner' });
  });

  it('blocks removing the owner', () => {
    const anotherOwner = { userId: 'u-other-owner', role: 'owner' as FamilyRole };
    expect(checkMemberRemoval({ actor: owner, target: anotherOwner }))
      .toEqual({ ok: false, reason: 'target-is-owner' });
  });

  it('blocks self-removal (leaving is a different flow)', () => {
    expect(checkMemberRemoval({ actor: bob, target: bob }))
      .toEqual({ ok: false, reason: 'self-removal' });
  });
});

describe('ROLE_LABELS', () => {
  it('covers all roles', () => {
    expect(ROLE_LABELS.owner).toBe('管理员');
    expect(ROLE_LABELS.editor).toBe('编辑者');
    expect(ROLE_LABELS.viewer).toBe('查看者');
  });
});

describe('VISIBILITY_LABELS', () => {
  it('covers both visibilities', () => {
    expect(VISIBILITY_LABELS.family).toBe('家庭共享');
    expect(VISIBILITY_LABELS.private).toBe('仅自己可见');
  });
});

describe('filterVisibleAssets', () => {
  const alice = 'u-alice';
  const bob = 'u-bob';

  const alicePrivate = mkAsset('a1', alice, 'private');
  const aliceFamily = mkAsset('a2', alice, 'family');
  const bobPrivate = mkAsset('a3', bob, 'private');
  const bobFamily = mkAsset('a4', bob, 'family');
  const all = [alicePrivate, aliceFamily, bobPrivate, bobFamily];

  it('owner sees everything (even others\' private)', () => {
    const visible = filterVisibleAssets(all, alice, 'owner');
    expect(visible.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('editor sees own private + all family assets, but not others\' private', () => {
    const visible = filterVisibleAssets(all, alice, 'editor');
    expect(visible.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a4']);
  });

  it('viewer sees all family assets + own private only', () => {
    const visible = filterVisibleAssets(all, alice, 'viewer');
    expect(visible.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a4']);
  });

  it('swapping the viewer swaps which private is hidden', () => {
    const visible = filterVisibleAssets(all, bob, 'editor');
    expect(visible.map((a) => a.id).sort()).toEqual(['a2', 'a3', 'a4']);
  });

  it('soft-deleted assets are caller\'s responsibility (filter is visibility-only)', () => {
    const deleted = mkAsset('a5', alice, 'family', { deletedAt: '2026-09-01T00:00:00Z' });
    const visible = filterVisibleAssets([...all, deleted], alice, 'owner');
    expect(visible.map((a) => a.id)).toContain('a5');
  });
});

describe('canCreatePrivateAsset', () => {
  it('owner can', () => expect(canCreatePrivateAsset('owner')).toBe(true));
  it('editor can', () => expect(canCreatePrivateAsset('editor')).toBe(true));
  it('viewer cannot', () => expect(canCreatePrivateAsset('viewer')).toBe(false));
});

function mkAsset(
  id: string,
  ownerId: string,
  visibility: Visibility,
  overrides: Partial<{ deletedAt: string | null }> = {},
) {
  return {
    id,
    familyId: 'f1',
    ownerId,
    type: 'cash' as const,
    name: id,
    currentAmount: 0,
    currency: 'CNY' as const,
    visibility,
    details: {},
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    deletedAt: null as string | null,
    ...overrides,
  };
}
