/**
 * PGlite 集成测试 harness
 *
 * 用真实的 Postgres（WASM）离线验证 supabase/migrations 下的 SQL：
 *   1. 补齐 Supabase 平台预置的环境：auth schema / anon / authenticated /
 *      service_role 角色 —— 让迁移文件一字不改就能跑
 *   2. auth.uid() shim：读 current_setting('test.uid')，测试里按用户切换
 *   3. 每个测试用户一个 nologin 角色，通过 SET ROLE 以该身份执行 ——
 *      PGlite 连接用户是表 owner（超级用户），不 SET ROLE 会绕过 RLS，
 *      验证不了 policy；SECURITY DEFINER 函数以 owner 执行照常绕过 RLS，
 *      与 Supabase（postgres 建表建函数）同构
 *   4. 按文件名顺序应用全部迁移（init_extensions 除外：PGlite 里 pgcrypto
 *      手动装，alter database 语句无意义）
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RPC_TESTS_DIR = fileURLToPath(new URL('..', import.meta.url)); // rpc-tests/
const MIGRATIONS_DIR = join(RPC_TESTS_DIR, '..', 'supabase', 'migrations');

export const USERS = {
  alice: '00000000-0000-4000-8000-000000000001',
  bob: '00000000-0000-4000-8000-000000000002',
  carol: '00000000-0000-4000-8000-000000000003',
  dave: '00000000-0000-4000-8000-000000000004',
};

const TEST_ROLES = ['u_alice', 'u_bob', 'u_carol', 'u_dave'];

export async function setupDb() {
  const db = new PGlite();

  // —— Supabase 平台预置环境 ——
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text not null unique);

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
  `);

  // 哈希/UUID 都用 core 函数（sha256 PG11+ / gen_random_uuid PG13+），
  // 无需 pgcrypto（PGlite 的 contrib 里也没有它）
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (f === '20260907000000_init_extensions.sql') continue;
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }

  // —— 种子用户 ——
  for (const [name, id] of Object.entries(USERS)) {
    await db.sql`insert into auth.users (id, email) values (${id}, ${`${name}@test.local`})`;
  }

  // —— 测试角色：模拟 Supabase authenticated 的授权面 ——
  // 直接授予表权限，让 RLS 成为唯一防线（与 Supabase 一致），
  // 测试才是在测 policy 而不是 ACL。
  await db.exec(`
    create role u_alice nologin;
    create role u_bob nologin;
    create role u_carol nologin;
    create role u_dave nologin;
  `);
  await db.exec(`
    grant usage on schema public, auth to ${TEST_ROLES.join(', ')};
    grant select, insert, update, delete on all tables in schema public
      to ${TEST_ROLES.join(', ')};
    grant execute on all functions in schema public
      to ${TEST_ROLES.join(', ')};
    grant execute on function auth.uid() to ${TEST_ROLES.join(', ')};
  `);

  return db;
}

/** 以某个测试用户身份执行一条带参数的查询，返回 rows（db.query 兼容 node-postgres 形式） */
export async function as(db, user, sql, params) {
  await db.exec('reset role');
  await db.sql`select set_config('test.uid', ${USERS[user]}, false)`;
  await db.exec(`set role u_${user}`);
  return db.query(sql, params ?? []);
}

/** 未认证（uid 为空）身份执行 */
export async function asAnon(db, sql, params) {
  await db.exec('reset role');
  await db.sql`select set_config('test.uid', '', false)`;
  await db.exec('set role anon');
  return db.query(sql, params ?? []);
}

const KNOWN_CODES = [
  'not-authenticated',
  'invalid-name',
  'invalid-wrapped-fdk',
  'invalid-reason',
  'rate-limited',
  'invite-not-found',
  'invite-revoked',
  'invite-claimed',
  'invite-locked',
  'invite-expired',
  'already-member',
  'not-claimant',
  'family-not-found',
  'self-removal',
  'not-owner',
  'target-is-owner',
  'rotation-in-progress',
  'no-active-rotation',
  'not-member',
  'pending-members',
];

/** 从 PGlite 抛出的错误里解析业务错误码 */
export function errorCode(e) {
  const msg = String((e && e.message) || e);
  for (const c of KNOWN_CODES) {
    if (msg.includes(c)) return c;
  }
  if (/violates row-level security/i.test(msg)) return 'rls-violation';
  if (/permission denied/i.test(msg)) return 'permission-denied';
  return `unknown: ${msg}`;
}

/** 断言该调用以指定错误码失败；成功则抛错 */
export async function expectFail(db, user, sql, params, expected) {
  try {
    await as(db, user, sql, params);
  } catch (e) {
    const code = errorCode(e);
    if (code !== expected) {
      throw new Error(`期望错误码 "${expected}"，实际 "${code}"`);
    }
    return code;
  }
  throw new Error(`期望失败（${expected}）但成功了: ${sql}`);
}
