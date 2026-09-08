/**
 * 家庭共享 RPC 迁移（20260908000001_family_rpc.sql）的 PGlite 集成测试
 *
 * 一条完整故事线串起七个 RPC：
 *   alice 建家庭 → 发邀请 → bob 凭码加入 → carol 凭码加入
 *   → alice 撤销 bob（验证撤销语义）→ 全员轮换闭环
 *   → bob 凭新邀请重进（软删行复用）
 * 另有 RLS 负测试（验证 W5 三个漏洞确实被修复）、限流、错误码、
 * 以及「SQL 哈希 === TS 哈希」的字节级对齐验证（用 node:crypto 复算
 * hashInviteCode 的归一化+sha256+base64，与 SQL 端比对）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setupDb, as, expectFail, errorCode, USERS } from '../src/harness.mjs';

const db = await setupDb();

// 与 packages/crypto hashInviteCode 字节级等价的实现（测试入参均为已归一化码）
const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

let familyId;
let bobMemberId;
let firstInviteId;

// alice 直接插入 invites 行 —— 真实客户端路径：owner 在本地生成码/密文，
// 服务端只见 hash。owner 的 RLS "owner manages invites" 放行。
async function insertInvite(codeStr, opts = {}) {
  const { expiresSql = "now() + interval '15 minutes'", status = 'pending' } = opts;
  const res = await as(db, 'alice', `
    insert into public.invites
      (family_id, code_hash, salt, wrapped_fdk, status, expires_at, created_by)
    values ($1, $2, $3, $4, $5, ${expiresSql}, $6)
    returning id
  `, [familyId, sha256b64(codeStr), 'c2FsdDE2Ynl0ZXM=', 'd3JhcHBlZC1mZGstaW52aXRl', status, USERS.alice]);
  return res.rows[0].id;
}

const memberCount = async (who) =>
  (await as(db, who, 'select count(*)::int as n from public.family_members where family_id = $1 and revoked_at is null', [familyId])).rows[0].n;

// ============================================================
// T1 create_family
// ============================================================
test('T1 create_family：建家庭 + owner 行 + 参数校验', async () => {
  const res = await as(db, 'alice',
    'select public.create_family($1, $2, $3) as id',
    ['陈家资产', 'owner-wrapped-fdk', 'Alice']);
  familyId = res.rows[0].id;
  assert.ok(familyId, '应返回家庭 id');

  const fam = await as(db, 'alice', 'select name, owner_id from public.families where id = $1', [familyId]);
  assert.equal(fam.rows[0].name, '陈家资产');
  assert.equal(fam.rows[0].owner_id, USERS.alice);

  const me = await as(db, 'alice',
    'select id, role, display_name, wrapped_fdk from public.family_members where family_id = $1', [familyId]);
  assert.equal(me.rows.length, 1);
  assert.equal(me.rows[0].role, 'owner');
  assert.equal(me.rows[0].display_name, 'Alice');
  assert.equal(me.rows[0].wrapped_fdk, 'owner-wrapped-fdk');

  await expectFail(db, 'alice', 'select public.create_family($1, $2) as id',
    ['  ', 'w'], 'invalid-name');
  await expectFail(db, 'alice', 'select public.create_family($1, $2) as id',
    ['X', ''], 'invalid-wrapped-fdk');
});

// ============================================================
// T2 邀请领取：归一化 + 哈希对齐 + 原子置 claimed
// ============================================================
test('T2 claim_invite：归一化/哈希对齐 + 领取材料返回', async () => {
  firstInviteId = await insertInvite('ABCD2345');

  // bob 输入小写 + 连字符 + 空格 —— 服务端归一化后必须与
  // node 侧 sha256('ABCD2345') 的 base64 命中同一行
  const res = await as(db, 'bob', 'select * from public.claim_invite($1)', [' abcd-2345 ']);
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  assert.equal(row.invite_id, firstInviteId);
  assert.equal(row.family_id, familyId);
  assert.equal(row.family_name, '陈家资产');
  assert.equal(row.salt, 'c2FsdDE2Ynl0ZXM=');
  assert.equal(row.wrapped_fdk, 'd3JhcHBlZC1mZGstaW52aXRl');

  const inv = await as(db, 'alice',
    'select status, claimed_by from public.invites where id = $1', [firstInviteId]);
  assert.equal(inv.rows[0].status, 'claimed');
  assert.equal(inv.rows[0].claimed_by, USERS.bob);
});

test('T3 同码二次领取 → invite-claimed', async () => {
  await expectFail(db, 'carol', 'select * from public.claim_invite($1)',
    ['ABCD2345'], 'invite-claimed');
});

// ============================================================
// T4/T5 finalize_join
// ============================================================
test('T4 finalize_join：写入成员行（viewer）', async () => {
  const res = await as(db, 'bob', 'select public.finalize_join($1, $2, $3) as id',
    [firstInviteId, 'bob-wrapped-fdk', 'Bob']);
  bobMemberId = res.rows[0].id;
  assert.ok(bobMemberId);

  const m = await as(db, 'alice',
    'select role, display_name, wrapped_fdk, revoked_at from public.family_members where id = $1',
    [bobMemberId]);
  assert.equal(m.rows[0].role, 'viewer');
  assert.equal(m.rows[0].display_name, 'Bob');
  assert.equal(m.rows[0].wrapped_fdk, 'bob-wrapped-fdk');
  assert.equal(m.rows[0].revoked_at, null);
});

test('T5 非领取人不能 finalize → not-claimant', async () => {
  await expectFail(db, 'carol', 'select public.finalize_join($1, $2, $3) as id',
    [firstInviteId, 'carol-wrapped', 'Carol'], 'not-claimant');
});

// ============================================================
// T6 错误码：错码 / 空码
// ============================================================
test('T6 错码与空码 → invite-not-found', async () => {
  await insertInvite('WXYZ6789');
  await expectFail(db, 'carol', 'select * from public.claim_invite($1)',
    ['WRONG9999'], 'invite-not-found');
  // 全空白归一化后是空串，哈希后匹配不到任何行
  await expectFail(db, 'carol', 'select * from public.claim_invite($1)',
    ['   '], 'invite-not-found');
});

test('T7 已是成员再领同家庭新码 → already-member（码不被烧掉）', async () => {
  await expectFail(db, 'bob', 'select * from public.claim_invite($1)',
    ['WXYZ6789'], 'already-member');
  const inv = await as(db, 'alice',
    'select status from public.invites where code_hash = $1',
    [sha256b64('WXYZ6789')]);
  assert.equal(inv.rows[0].status, 'pending');
});

test('T8 carol 完整加入 → 3 名活跃成员', async () => {
  const res = await as(db, 'carol', 'select * from public.claim_invite($1)', ['WXYZ6789']);
  const inviteId = res.rows[0].invite_id;
  await as(db, 'carol', 'select public.finalize_join($1, $2, $3) as id',
    [inviteId, 'carol-wrapped-fdk', 'Carol']);
  assert.equal(await memberCount('alice'), 3);
});

// ============================================================
// T9 RLS 负测试：W5 三个漏洞的修复回归
// ============================================================
test('T9 RLS：陌生人看不到任何家庭数据，插入被拒，非 owner 改名无效', async () => {
  // 漏洞 A：invites 材料不再对全员可见
  let rows = await as(db, 'dave', 'select * from public.invites');
  assert.equal(rows.rows.length, 0);
  rows = await as(db, 'dave', 'select * from public.rpc_call_log');
  assert.equal(rows.rows.length, 0);

  // 漏洞 C：families 表 RLS 已补
  rows = await as(db, 'dave', 'select * from public.families');
  assert.equal(rows.rows.length, 0);
  rows = await as(db, 'dave', 'select * from public.family_members');
  assert.equal(rows.rows.length, 0);
  rows = await as(db, 'dave', 'select * from public.family_key_rotations');
  assert.equal(rows.rows.length, 0);
  rows = await as(db, 'dave', 'select * from public.rotation_claims');
  assert.equal(rows.rows.length, 0);

  // 漏洞 B：不经 finalize_join 的成员自插被拒
  await expectFail(db, 'dave', `
    insert into public.family_members (family_id, user_id, display_name, role, wrapped_fdk)
    values ($1, $2, 'Dave', 'viewer', 'x')
  `, [familyId, USERS.dave], 'rls-violation');

  // 非 owner 改家庭名：USING 过滤后 0 行生效，无报错但不生效
  await as(db, 'carol', 'update public.families set name = $1 where id = $2',
    ['被改了', familyId]);
  const fam = await as(db, 'alice', 'select name from public.families where id = $1', [familyId]);
  assert.equal(fam.rows[0].name, '陈家资产');

  // 成员能看到家庭与自己人（成员列表页依赖）
  rows = await as(db, 'carol', 'select * from public.families where id = $1', [familyId]);
  assert.equal(rows.rows.length, 1);
  rows = await as(db, 'carol', 'select * from public.family_members where family_id = $1', [familyId]);
  assert.equal(rows.rows.length, 3);

  // sync_records：家庭内互相可见，陌生人不可见
  await as(db, 'alice', `
    insert into public.sync_records (user_id, family_id, record_id, kind, updated_at, envelope)
    values ($1, $2, $3, 'asset', now(), 'env-data')
  `, [USERS.alice, familyId, randomUUID()]);
  rows = await as(db, 'bob', 'select * from public.sync_records where family_id = $1', [familyId]);
  assert.equal(rows.rows.length, 1);
  rows = await as(db, 'dave', 'select * from public.sync_records where family_id = $1', [familyId]);
  assert.equal(rows.rows.length, 0);
});

// ============================================================
// T10 remove_member：裁决顺序 + 撤销语义
// ============================================================
test('T10 remove_member：self-removal 先于 not-owner + 撤销切断恢复路径', async () => {
  // 裁决顺序（坑 #19 回归）：非 owner 自删也应报 self-removal
  await expectFail(db, 'bob', 'select public.remove_member($1, $2) as n',
    [familyId, USERS.bob], 'self-removal');
  // 非 owner 删别人 → not-owner
  await expectFail(db, 'bob', 'select public.remove_member($1, $2) as n',
    [familyId, USERS.carol], 'not-owner');

  // alice 撤销 bob → 剩 2 人
  const res = await as(db, 'alice', 'select public.remove_member($1, $2) as n',
    [familyId, USERS.bob]);
  assert.equal(res.rows[0].n, 2);

  // bob 行：软删 + wrapped_fdk 清空（owner 可审计）
  const bobRow = await as(db, 'alice',
    'select revoked_at, wrapped_fdk from public.family_members where id = $1', [bobMemberId]);
  assert.notEqual(bobRow.rows[0].revoked_at, null);
  assert.equal(bobRow.rows[0].wrapped_fdk, '');

  // bob 领取过的邀请：claimed_by 被清 → 旧材料不能用于恢复
  const inv = await as(db, 'alice',
    'select claimed_by, status from public.invites where id = $1', [firstInviteId]);
  assert.equal(inv.rows[0].claimed_by, null);
  assert.equal(inv.rows[0].status, 'claimed');

  // bob 视角：全部家庭数据不可见
  let rows = await as(db, 'bob', 'select * from public.family_members where family_id = $1', [familyId]);
  assert.equal(rows.rows.length, 0);
  rows = await as(db, 'bob', 'select * from public.sync_records where family_id = $1', [familyId]);
  assert.equal(rows.rows.length, 0);

  // 旧领取记录重放 → not-claimant
  await expectFail(db, 'bob', 'select public.finalize_join($1, $2, $3) as id',
    [firstInviteId, 'bob-replay', null], 'not-claimant');

  // 撤销者不能领取轮换（撤销生效的核心断言）
  await expectFail(db, 'bob', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'x'], 'not-member');
});

// ============================================================
// T11 轮换闭环
// ============================================================
test('T11 轮换：start → 领取（幂等）→ complete，状态机全路径', async () => {
  const res = await as(db, 'alice', 'select public.start_rotation($1, $2, $3) as id',
    [familyId, 'rot-wrapped-new-fdk', 'member_removed']);
  const rotationId = res.rows[0].id;
  assert.ok(rotationId);

  // last_rotated_at 维护（needsRotation 的界）
  const fam = await as(db, 'alice', 'select last_rotated_at from public.families where id = $1', [familyId]);
  assert.notEqual(fam.rows[0].last_rotated_at, null);

  // 同一时间只允许一个未完成轮换
  await expectFail(db, 'alice', 'select public.start_rotation($1, $2, $3) as id',
    [familyId, 'w', 'manual'], 'rotation-in-progress');

  // 非法 reason
  await expectFail(db, 'alice', 'select public.start_rotation($1, $2, $3) as id',
    [familyId, 'w', 'whatever'], 'invalid-reason');

  // 陌生人 / 非 owner
  await expectFail(db, 'dave', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'w'], 'not-member');
  await expectFail(db, 'carol', 'select public.complete_rotation($1) as n',
    [familyId], 'not-owner');

  // carol 领取（幂等：两次调用只计一次，副本取最新）
  const c1 = await as(db, 'carol', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'carol-wrapped-a']);
  const c2 = await as(db, 'carol', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'carol-wrapped-b']);
  assert.equal(c1.rows[0].id, rotationId);
  assert.equal(c2.rows[0].id, rotationId);

  const claims = await as(db, 'alice',
    'select count(*)::int as n from public.rotation_claims where rotation_id = $1 and user_id = $2',
    [rotationId, USERS.carol]);
  assert.equal(claims.rows[0].n, 1);
  const carolRow = await as(db, 'alice', `
    select wrapped_fdk from public.family_members
    where family_id = $1 and user_id = $2
  `, [familyId, USERS.carol]);
  assert.equal(carolRow.rows[0].wrapped_fdk, 'carol-wrapped-b');

  // alice 未领 → complete 被拒
  await expectFail(db, 'alice', 'select public.complete_rotation($1) as n',
    [familyId], 'pending-members');

  // alice 领取后 → complete 成功
  await as(db, 'alice', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'alice-wrapped-new']);
  const done = await as(db, 'alice', 'select public.complete_rotation($1) as n', [familyId]);
  assert.equal(done.rows[0].n, 2);

  const rot = await as(db, 'alice',
    'select completed_at from public.family_key_rotations where id = $1', [rotationId]);
  assert.notEqual(rot.rows[0].completed_at, null);

  // 轮换关闭后不能再领
  await expectFail(db, 'carol', 'select public.claim_rotation($1, $2) as id',
    [familyId, 'x'], 'no-active-rotation');
});

// ============================================================
// T12 邀请状态机：expired / revoked / locked（trigger）
// ============================================================
test('T12 邀请状态：expired / revoked / locked', async () => {
  await insertInvite('EXPIRE99', { expiresSql: "now() - interval '1 hour'" });
  await expectFail(db, 'bob', 'select * from public.claim_invite($1)', ['EXPIRE99'], 'invite-expired');

  await insertInvite('REVOKE88', { status: 'revoked' });
  await expectFail(db, 'bob', 'select * from public.claim_invite($1)', ['REVOKE88'], 'invite-revoked');

  // attempts 到上限 → W5 的 trigger 自动置 locked
  const lockedId = await insertInvite('LOCKED77');
  await as(db, 'alice', 'update public.invites set attempts = 10 where id = $1', [lockedId]);
  const st = await as(db, 'alice', 'select status from public.invites where id = $1', [lockedId]);
  assert.equal(st.rows[0].status, 'locked');
  await expectFail(db, 'bob', 'select * from public.claim_invite($1)', ['LOCKED77'], 'invite-locked');
});

// ============================================================
// T13 限流：20 次成功领取 / 15 分钟 / 用户 → 第 21 次被拒
//
// ⚠️ PL/pgSQL 的 RAISE EXCEPTION 会回滚整条函数事务，意味着「抛错之前
// 的副作用」也跟着丢。所以 rpc_call_log 只能记到「成功领取」，错码
// 尝试写日志也会被回滚。错码在线枚举的限流放在网关/WAF（按 IP 维度），
// DB 层无能为力。这里测的是 DB 层能做的部分：累计 20 次成功 claim 后
// 下一次被拒。
//
// 选用 eve（全新用户，前面无 claim 记录）避免与 T2/T8 的 carol 累积冲突。
// ============================================================
test('T13 claim_invite 限流：累计 20 次后被拒', async () => {
  // eve 是新用户，前面无 claim 记录；用 dave 发的码，dave 不参与 claim
  const EVE = '00000000-0000-4000-8000-000000000005';
  // 注意：必须在 superuser 身份下插 auth.users + 建 u_eve（u_eve 没有 INSERT users 权限）
  await db.exec('reset role');
  await db.exec(`insert into auth.users (id, email) values ('${EVE}', 'eve@test.local') on conflict do nothing`);
  await db.exec(`create role u_eve nologin`);
  await db.exec(`
    grant usage on schema public, auth to u_eve;
    grant select, insert, update, delete on all tables in schema public to u_eve;
    grant execute on all functions in schema public to u_eve;
    grant execute on function auth.uid() to u_eve;
  `);

  await as(db, 'dave', 'select public.create_family($1, $2, $3) as id',
    ['限流测试家庭', 'dave-wrapped', 'Dave']);
  const rlFam = (await as(db, 'dave',
    'select id from public.families where name = $1', ['限流测试家庭'])).rows[0].id;

  // 21 张独立合法邀请
  const codes = Array.from({ length: 21 }, (_, i) =>
    `RL${String(i).padStart(4, '0')}X`);
  for (let i = 0; i < 21; i++) {
    await as(db, 'dave', `
      insert into public.invites
        (family_id, code_hash, salt, wrapped_fdk, status, expires_at, created_by)
      values ($1, $2, $3, $4, 'pending', now() + interval '15 minutes', $5)
    `, [rlFam, sha256b64(codes[i]), 'c2FsdA==', 'd3JhcHBlZA==', USERS.dave]);
  }

  // eve 连续领取 20 次 —— 全部成功
  for (let i = 0; i < 20; i++) {
    // 直接走 set role + set_config，绕过 USERS 索引
    await db.exec('reset role');
    await db.sql`select set_config('test.uid', ${EVE}, false)`;
    await db.exec(`set role u_eve`);
    const r = await db.query('select * from public.claim_invite($1)', [codes[i]]);
    assert.equal(r.rows.length, 1, `第 ${i + 1} 次应成功`);
  }
  // 第 21 次：限流命中
  await db.exec('reset role');
  await db.sql`select set_config('test.uid', ${EVE}, false)`;
  await db.exec(`set role u_eve`);
  try {
    await db.query('select * from public.claim_invite($1)', [codes[20]]);
    throw new Error('期望失败但成功了');
  } catch (e) {
    assert.equal(errorCode(e), 'rate-limited');
  }
});

// ============================================================
// T14 未认证
// ============================================================
test('T14 已认证但 uid 为空 → not-authenticated', async () => {
  // 切换到 u_dave（有函数执行权限），再清空 test.uid —— 模拟
  // 「authenticated 角色但 JWT 解析失败」的边界。anon 角色会被
  // 迁移里的 revoke 拦在函数外（permission-denied），那是另一条防线。
  await db.exec('reset role');
  await db.sql`select set_config('test.uid', '', false)`;
  await db.exec('set role u_dave');
  try {
    await db.query('select * from public.claim_invite($1)', ['ABCD2345']);
    throw new Error('期望失败但成功了');
  } catch (e) {
    assert.equal(errorCode(e), 'not-authenticated');
  }
});

// ============================================================
// T15 profiles fallback
// ============================================================
test('T15 create_family 无入参展示名 → 落到 profiles.display_name', async () => {
  await as(db, 'alice', `
    insert into public.profiles (id, email, display_name, salt, password_check_envelope)
    values ($1, $2, $3, $4, $5)
  `, [USERS.alice, 'alice@test.local', 'Alice P.', 'c2FsdA==', 'env']);

  const res = await as(db, 'alice', 'select public.create_family($1, $2) as id',
    ['备份家庭', 'w2']);
  const fam2 = res.rows[0].id;

  const owner = await as(db, 'alice', `
    select display_name, role from public.family_members
    where family_id = $1 and user_id = $2
  `, [fam2, USERS.alice]);
  assert.equal(owner.rows[0].display_name, 'Alice P.');
  assert.equal(owner.rows[0].role, 'owner');
});

// ============================================================
// T16 被撤销成员凭新邀请重进：软删行复用
// ============================================================
test('T16 bob 凭新邀请重进 → 复用原成员行，角色 viewer', async () => {
  const inviteId = await insertInvite('REJOIN01');
  const claimRes = await as(db, 'bob', 'select * from public.claim_invite($1)', ['REJOIN01']);
  assert.equal(claimRes.rows[0].invite_id, inviteId);

  const fin = await as(db, 'bob', 'select public.finalize_join($1, $2, $3) as id',
    [inviteId, 'bob-wrapped-new', 'Bob回来了']);
  // 复用软删行（unique(family_id,user_id)），不是新行
  assert.equal(fin.rows[0].id, bobMemberId);

  const m = await as(db, 'alice', `
    select role, revoked_at, wrapped_fdk, display_name
    from public.family_members where id = $1
  `, [bobMemberId]);
  assert.equal(m.rows[0].role, 'viewer');
  assert.equal(m.rows[0].revoked_at, null);
  assert.equal(m.rows[0].wrapped_fdk, 'bob-wrapped-new');
  assert.equal(m.rows[0].display_name, 'Bob回来了');
  assert.equal(await memberCount('alice'), 3);
});
