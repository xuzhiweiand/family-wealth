-- ============================================================
-- W6 迁移：家庭共享 RPC —— 把 W5 的表能力升级为安全的服务端闭环
--
-- 为什么需要 RPC：RLS 无法表达跨表条件（如「这条邀请确实是你领取的」
-- 「轮换确实全员领完」），而放行宽泛的 select/insert policy 会造成：
--   漏洞 A（invites）："claim requires code hash" 把所有 pending 邀请的
--     salt + wrapped_fdk 泄露给任意已登录用户 —— 等于公开离线爆破材料
--   漏洞 B（family_members）："self join via invite" 允许跳过邀请校验
--     直接插入成员行
--   漏洞 C（families，本次新发现）：W5 建表后漏开 RLS —— 任意登录用户
--     可读写家庭元数据（改他人家庭名 / 伪造 owner 关系）
--   漏洞 D（PGlite 集成测试首跑发现）：family_members 的
--     "members visible to family" 在自己的 policy 里再查
--     family_members —— PG 判定 infinite recursion，整条 RLS 链
--     根本跑不起来（W5 只过了 TS 测试，SQL 从未被真正执行过）
-- 因此本迁移把所有成员变更 / 领取动作收进 SECURITY DEFINER 函数：
--   - 函数以表 owner 身份执行，绕过 RLS 做受控写入（所有表 owner 均
--     未开启 force RLS，与 Supabase 的 postgres 同构）
--   - 每个入口先做 auth.uid() 非空检查
--   - 错误约定：raise exception '<code>'，code 与 packages/family
--     gateway（本迁移的配套 TS 层）的错误映射一一对应
--
-- ⚠️ search_path 固定（防 SECURITY DEFINER 植入），保留 extensions
--   备将来使用扩展函数。哈希用 core 的 sha256()（PG11+ 内置，
--   Supabase / PGlite 都有），不依赖 pgcrypto —— 它不在 PGlite 的
--   contrib 扩展集里。
--
-- 并发模型：所有「一次性 / 全员完成」语义靠条件 UPDATE 的原子性
-- （where status='pending' returning ...）+ 行锁串行化保证，
-- 不依赖 select for update。
--
-- 未决问题（不在本迁移处理）：
--   - 单家庭约束（一用户仅一活跃家庭）目前由客户端 UX 保证，
--     服务端不强制 —— 留待产品明确后再收紧
--   - rpc_call_log 的定时清理用顺带 DELETE 兜底，正式方案是 pg_cron
-- ============================================================

-- ---------- 修复 W5 的四个漏洞 ----------

-- 漏洞 D 先修（其他 policy 都依赖它）：成员资格判定统一走
-- is_active_member() 助手 —— SECURITY DEFINER 以 owner 身份读表，
-- 不触发 family_members 的 RLS，自引用递归链断开（Supabase 处理
-- 跨表 / 自引用 policy 的标准手法）。
--
-- 注意：本函数刻意保持对 PUBLIC 可执行（policy 求值需要），且只
-- 接受 family_id、不接受 user 参数 —— 它只回答「当前登录用户是否
-- 为活跃成员」，不构成他人成员关系的查询预言机。
create or replace function public.is_active_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = p_family_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
  );
$$;

-- 漏洞 A：领取材料批量泄露。claim 全部走 claim_invite RPC（definer 内部查询）
drop policy if exists "claim requires code hash" on public.invites;

-- 漏洞 B：未经邀请校验的成员自插行。成员行只经 finalize_join 写入
drop policy if exists "self join via invite" on public.family_members;

-- 漏洞 C：families 漏开 RLS。创建走 create_family RPC；
-- 改名由 owner 直接 update（policy 可表达，无需 RPC）
alter table public.families enable row level security;

drop policy if exists "family visible to active members" on public.families;
create policy "family visible to active members"
  on public.families for select
  using (public.is_active_member(id));

drop policy if exists "owner updates family" on public.families;
create policy "owner updates family"
  on public.families for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 漏洞 D 修复：以下成员资格 policy 全部重写为 is_active_member(...)
drop policy if exists "members visible to family" on public.family_members;
create policy "members visible to family"
  on public.family_members for select
  using (revoked_at is null and public.is_active_member(family_id));

drop policy if exists "rotations visible to active members" on public.family_key_rotations;
create policy "rotations visible to active members"
  on public.family_key_rotations for select
  using (public.is_active_member(family_id));

drop policy if exists "family sync rows" on public.sync_records;
create policy "family sync rows"
  on public.sync_records for select
  using (public.is_active_member(family_id));

-- 轮换表收窄为「单一写路径」：写入只经 start_rotation / complete_rotation
-- RPC。直接 insert 会漏掉 last_rotated_at 维护（needsRotation 误报），
-- 直接 update 会绕过「全员领取完成」校验 —— 两个 policy 均移除。
drop policy if exists "owner creates rotations" on public.family_key_rotations;
drop policy if exists "owner completes rotations" on public.family_key_rotations;

-- ---------- RPC 调用日志（防在线枚举的限流） ----------
-- 邀请码的 attempts 计数器只能看到「码哈希对上了」的调用；猜错的哈希
-- 匹配不到任何行、无从计数。所以防「部分已知码的在线枚举」（缺 2 位
-- 即 961 种组合）必须按「调用者」维度限流：20 次 / 15 分钟 / 用户。
-- 这是 DB 层能做的全部 —— IP 维度限流是网关 / WAF 的职责。

create table if not exists public.rpc_call_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  rpc text not null,
  called_at timestamptz not null default now()
);

create index if not exists rpc_call_log_user_idx
  on public.rpc_call_log (user_id, rpc, called_at desc);

-- RLS 开启且无任何 policy：直连零行零写，只有 SECURITY DEFINER 函数可写
alter table public.rpc_call_log enable row level security;

-- ---------- 轮换领取记录 ----------
-- 每个成员对每次轮换的领取动作（幂等去重）；complete_rotation 据此
-- 判断「全员领完」。写入只经 claim_rotation RPC。

create table if not exists public.rotation_claims (
  id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null references public.family_key_rotations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  unique (rotation_id, user_id)
);

create index if not exists rotation_claims_rotation_idx
  on public.rotation_claims (rotation_id);

alter table public.rotation_claims enable row level security;

drop policy if exists "claims visible to active members" on public.rotation_claims;
create policy "claims visible to active members"
  on public.rotation_claims for select
  using (
    exists (
      select 1
      from public.family_key_rotations r
      join public.family_members me on me.family_id = r.family_id
      where r.id = rotation_claims.rotation_id
        and me.user_id = auth.uid()
        and me.revoked_at is null
    )
  );

-- ============================================================
-- create_family：创建家庭 + 写入 owner 成员行
--
-- p_wrapped_fdk 是「owner 用自己 UMK 加密的 FDK 副本」，
-- FDK 明文永远不出设备。
-- ============================================================

create or replace function public.create_family(
  p_name text,
  p_wrapped_fdk text,
  p_display_name text default null,
  p_family_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_family_id uuid;
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'invalid-name';
  end if;
  if coalesce(p_wrapped_fdk, '') = '' then
    raise exception 'invalid-wrapped-fdk';
  end if;

  -- family_id 允许由客户端指定：FDK 成员副本的 AAD 含 familyId，
  -- 客户端必须先知道 id 才能完成 wrap。id 为 UUID 且 owner 行同事务写入，
  -- 被抢占/伪造均无收益。
  insert into public.families (id, name, owner_id)
  values (coalesce(p_family_id, gen_random_uuid()), btrim(p_name), auth.uid())
  returning id into v_family_id;

  -- 展示名优先级：入参 > profiles.display_name > 'Owner'
  -- 注意必须保证恒有一行（LEFT JOIN 自 dummy）：
  -- 若直接 from profiles，无 profile 行时 select into 得到 NULL，
  -- 入参会跟着丢
  select coalesce(
           nullif(btrim(p_display_name), ''),
           nullif(btrim(pr.display_name), ''),
           'Owner'
         )
    into v_display_name
    from (select 1) as x
    left join public.profiles pr on pr.id = auth.uid();

  insert into public.family_members (family_id, user_id, display_name, role, wrapped_fdk)
  values (v_family_id, auth.uid(), coalesce(v_display_name, 'Owner'), 'owner', p_wrapped_fdk);

  return v_family_id;
end;
$$;

-- ============================================================
-- claim_invite：凭邀请码领取（唯一的 FDK 交接入口）
--
-- 客户端必须先做 normalizeInviteCode（去空白/连字符、转大写）再传入，
-- 服务端的归一化只是第二道防线 —— 两边对 ASCII 的处理完全一致。
-- 服务端流程：
--   1. 按「调用者」限流（成功与猜错都计数）
--   2. hash 对应：base64(SHA256(归一化码))，
--      与 packages/crypto hashInviteCode 字节级对齐
--   3. 可用性裁决：revoked → claimed → locked → expired
--   4. 原子置 claimed：条件 UPDATE 的 EvalPlanQual 语义保证
--      并发领取只有一个成功
-- 成功返回领取材料（salt + wrapped_fdk + 家庭信息）。
-- 码明文永远不出现在任何表里。
-- ============================================================

create or replace function public.claim_invite(p_code text)
returns table (
  invite_id uuid,
  family_id uuid,
  family_name text,
  salt text,
  wrapped_fdk text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_inv record;
  v_claimed_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;

  -- 顺带清理一天前的日志（正式方案：pg_cron 定时任务）
  delete from public.rpc_call_log
   where called_at < now() - interval '1 day';

  -- ⚠️ 限流的真实可防御面：
  --   plpgsql 函数抛错时整条事务回滚，意味着「抛错之前的
  --   副作用」也跟着丢。错码（invite-not-found）的尝试无法
  --   写日志，所以这层 DB 限流只能挡住「同用户短时间反复成功
  --   领取」一类滥用。错码的在线枚举（部分已知码的高频猜测）
  --   是网关 / WAF 的职责（按 IP 限流），DB 层无能为力。
  -- 记成功领取的次数：
  if (
    select count(*)
    from public.rpc_call_log
    where user_id = auth.uid()
      and rpc = 'claim_invite'
      and called_at > now() - interval '15 minutes'
  ) >= 20 then
    raise exception 'rate-limited';
  end if;

  -- 与 packages/crypto hashInviteCode 严格对齐
  v_hash := encode(
    sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'UTF8')),
    'base64'
  );

  -- 同一码可能有历史行（用过/作废后重发同码）：pending 优先、新行优先
  select *
    into v_inv
    from public.invites i
   where i.code_hash = v_hash
   order by (i.status = 'pending') desc, i.created_at desc
   limit 1;

  if not found then
    raise exception 'invite-not-found';
  end if;

  if v_inv.status = 'revoked' then
    raise exception 'invite-revoked';
  end if;
  if v_inv.status = 'claimed' then
    raise exception 'invite-claimed';
  end if;
  if v_inv.status = 'locked' or v_inv.attempts >= v_inv.max_attempts then
    raise exception 'invite-locked';
  end if;
  if v_inv.status = 'expired' or v_inv.expires_at <= now() then
    raise exception 'invite-expired';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invite-not-found';
  end if;

  -- 已是该家庭活跃成员 → 不烧码（TS joinByCode 同语义）
  if exists (
    select 1 from public.family_members m
    where m.family_id = v_inv.family_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
  ) then
    raise exception 'already-member';
  end if;

  -- 原子领取：并发时条件 UPDATE 只有一个事务能改到行
  update public.invites
     set status = 'claimed',
         claimed_by = auth.uid()
   where id = v_inv.id
     and status = 'pending'
   returning id into v_claimed_id;

  if v_claimed_id is null then
    raise exception 'invite-claimed';
  end if;

  -- 成功领取后记日志（限流计数在此）；若之后抛错，整事务回滚
  -- 日志也跟着丢 —— 这正是有意为之：日志只反映"成功到达领取点"的次数。
  -- 错码枚举走网关/WAF。
  insert into public.rpc_call_log (user_id, rpc)
  values (auth.uid(), 'claim_invite');

  return query
  select v_inv.id,
         v_inv.family_id,
         f.name,
         v_inv.salt,
         v_inv.wrapped_fdk
    from public.families f
   where f.id = v_inv.family_id;
end;
$$;

-- ============================================================
-- finalize_join：领取人写入自己的成员行
--
-- 必须先经 claim_invite 拿到材料，并在客户端用自己的 UMK 重新加密
-- FDK，再调用本函数落库。校验链：
--   - 邀请存在且 claimed_by 是调用者本人
--   - 不是该家庭的活跃成员（防旧材料重放）
--   - 曾被撤销后受邀重进：复用软删行（unique 约束），重置为 viewer
-- remove_member 会清掉被撤销者的 claimed_by 引用，因此旧邀请
-- 不能在被撤销后用于自我恢复。
-- ============================================================

create or replace function public.finalize_join(
  p_invite_id uuid,
  p_wrapped_fdk text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv record;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;
  if coalesce(p_wrapped_fdk, '') = '' then
    raise exception 'invalid-wrapped-fdk';
  end if;

  select * into v_inv
    from public.invites
   where id = p_invite_id;

  if not found then
    raise exception 'invite-not-found';
  end if;

  if v_inv.claimed_by is distinct from auth.uid() then
    raise exception 'not-claimant';
  end if;

  -- 已是活跃成员 → 拒绝（重放旧领取材料）
  if exists (
    select 1 from public.family_members m
    where m.family_id = v_inv.family_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
  ) then
    raise exception 'already-member';
  end if;

  -- 曾被撤销后重新受邀：复用软删行
  update public.family_members
     set revoked_at = null,
         wrapped_fdk = p_wrapped_fdk,
         display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
         role = 'viewer',
         joined_at = now()
   where family_id = v_inv.family_id
     and user_id = auth.uid()
   returning id into v_member_id;

  if v_member_id is null then
    insert into public.family_members (family_id, user_id, display_name, role, wrapped_fdk)
    values (v_inv.family_id, auth.uid(),
            coalesce(nullif(btrim(p_display_name), ''), '成员'),
            'viewer', p_wrapped_fdk)
    returning id into v_member_id;
  end if;

  return v_member_id;
end;
$$;

-- ============================================================
-- remove_member：撤销成员（软删）+ 切断自动恢复路径
--
-- 裁决顺序与 packages/family checkMemberRemoval 一致：
-- 先 self-removal（产品语义：引导去「退出家庭」流程，而非笼统权限错误），
-- 再 not-owner，再 target-is-owner。
-- 撤销动作：
--   - family_members 行置 revoked_at、清空 wrapped_fdk
--   - 该用户领取过（未 finalize）的邀请清空 claimed_by ——
--     防止被撤销者事后用旧领取记录给自己补成员行
--   - 新数据访问由 RLS（活跃成员判定）+ FDK 轮换切断；
--     已下载的历史密文无法远程擦除，UI 必须提示「立即轮换」
-- 返回剩余活跃成员数。
-- ============================================================

create or replace function public.remove_member(
  p_family_id uuid,
  p_target_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid;
  v_remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;

  select owner_id into v_owner
    from public.families
   where id = p_family_id;

  if not found then
    raise exception 'family-not-found';
  end if;

  if p_target_user_id = auth.uid() then
    raise exception 'self-removal';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not-owner';
  end if;
  if p_target_user_id = v_owner then
    raise exception 'target-is-owner';
  end if;

  update public.family_members
     set revoked_at = now(),
         wrapped_fdk = ''
   where family_id = p_family_id
     and user_id = p_target_user_id
     and revoked_at is null;

  -- 切断「旧领取记录」恢复路径
  update public.invites
     set claimed_by = null
   where claimed_by = p_target_user_id
     and family_id = p_family_id
     and status = 'claimed';

  select count(*) into v_remaining
    from public.family_members
   where family_id = p_family_id
     and revoked_at is null;

  return v_remaining;
end;
$$;

-- ============================================================
-- start_rotation：owner 发起 FDK 轮换
--
-- p_wrapped_new_fdk = AES-GCM(FDK_new, FDK_old, aad=rotation:${familyId})，
-- 由客户端加密后上传，服务端全程只见密文。
-- 同一时间只允许一个未完成的轮换（claim / complete 都按「最新的未完成
-- 轮换」工作）；若某成员彻底失联，owner 可先 remove_member 缩小活跃
-- 集合，再 complete。
-- ============================================================

create or replace function public.start_rotation(
  p_family_id uuid,
  p_wrapped_new_fdk text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid;
  v_rotation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;
  if p_reason not in ('member_removed', 'manual', 'device_lost') then
    raise exception 'invalid-reason';
  end if;
  if coalesce(p_wrapped_new_fdk, '') = '' then
    raise exception 'invalid-wrapped-fdk';
  end if;

  select owner_id into v_owner
    from public.families
   where id = p_family_id;

  if not found then
    raise exception 'family-not-found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not-owner';
  end if;

  if exists (
    select 1 from public.family_key_rotations
    where family_id = p_family_id
      and completed_at is null
  ) then
    raise exception 'rotation-in-progress';
  end if;

  insert into public.family_key_rotations (family_id, reason, wrapped_new_fdk, created_by)
  values (p_family_id, p_reason, p_wrapped_new_fdk, auth.uid())
  returning id into v_rotation_id;

  -- needsRotation 以此为界：撤销时间早于它的撤销已被轮换覆盖
  update public.families
     set last_rotated_at = now()
   where id = p_family_id;

  return v_rotation_id;
end;
$$;

-- ============================================================
-- claim_rotation：成员领取新 FDK 副本
--
-- 前置：调用者仍是该家庭的活跃成员 —— revoked 的人在此被挡，
-- 这是「撤销生效」的关键一环：他拿不到 FDK_new。
-- 客户端流程：读 rotation.wrapped_new_fdk → 用手里的 FDK_old 解出
-- FDK_new → 用自己 UMK 重新加密 → p_wrapped_fdk 传回。
-- 幂等：重复领取只重写自己的副本，不重复计数。
-- ============================================================

create or replace function public.claim_rotation(
  p_family_id uuid,
  p_wrapped_fdk text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rotation record;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;
  if coalesce(p_wrapped_fdk, '') = '' then
    raise exception 'invalid-wrapped-fdk';
  end if;

  if not exists (
    select 1 from public.family_members m
    where m.family_id = p_family_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
  ) then
    raise exception 'not-member';
  end if;

  select * into v_rotation
    from public.family_key_rotations
   where family_id = p_family_id
     and completed_at is null
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'no-active-rotation';
  end if;

  insert into public.rotation_claims (rotation_id, user_id)
  values (v_rotation.id, auth.uid())
  on conflict (rotation_id, user_id) do nothing;

  -- 更新自己的副本（无论是否首次领取，都取最新传入值；
  -- 与 RLS "self update wrapped fdk" 等权，无提权面）
  update public.family_members
     set wrapped_fdk = p_wrapped_fdk
   where family_id = p_family_id
     and user_id = auth.uid();

  return v_rotation.id;
end;
$$;

-- ============================================================
-- complete_rotation：全员领取完成后由 owner 关闭轮换
--
-- 「全员」= 此刻的全部活跃成员（中途被撤销者的历史领取不算数）。
-- completed_at 置位后，旧 FDK 即可安全废弃。
-- ============================================================

create or replace function public.complete_rotation(p_family_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid;
  v_rotation record;
  v_total integer;
  v_claimed integer;
begin
  if auth.uid() is null then
    raise exception 'not-authenticated';
  end if;

  select owner_id into v_owner
    from public.families
   where id = p_family_id;

  if not found then
    raise exception 'family-not-found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not-owner';
  end if;

  select * into v_rotation
    from public.family_key_rotations
   where family_id = p_family_id
     and completed_at is null
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'no-active-rotation';
  end if;

  select count(*) into v_total
    from public.family_members
   where family_id = p_family_id
     and revoked_at is null;

  select count(*) into v_claimed
    from public.rotation_claims c
    join public.family_members m
      on m.family_id = p_family_id
     and m.user_id = c.user_id
     and m.revoked_at is null
   where c.rotation_id = v_rotation.id;

  if v_claimed < v_total then
    raise exception 'pending-members';
  end if;

  update public.family_key_rotations
     set completed_at = now()
   where id = v_rotation.id
     and completed_at is null;

  return v_total;
end;
$$;

-- ---------- 执行权限：仅登录用户（service_role 用于后台运维） ----------
-- SECURITY DEFINER 函数默认对 PUBLIC 可执行，必须收紧。
-- anon / authenticated / service_role 在 Supabase 平台预置；
-- PGlite 集成测试里由 harness 预先创建同名角色。

do $$
declare
  sig text;
begin
  foreach sig in array array[
    'create_family(text, text, text, uuid)',
    'claim_invite(text)',
    'finalize_join(uuid, text, text)',
    'remove_member(uuid, uuid)',
    'start_rotation(uuid, text, text)',
    'claim_rotation(uuid, text)',
    'complete_rotation(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', sig);
    execute format('grant execute on function public.%s to authenticated, service_role', sig);
  end loop;
end $$;
