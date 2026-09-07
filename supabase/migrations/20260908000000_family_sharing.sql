-- ============================================================
-- W5 迁移：多成员家庭共享
--
-- 配套 ADR-0010（FDK 分发与邀请码安全模型）。
-- 服务端在所有家庭数据表上只能看到：
--   结构化元数据（family_id / user_id / role / 时间戳）
--   + wrapped_fdk（密文，用成员自己的 UMK 或邀请码 KEK 加密）
-- 金额、资产名、备注等明文永远不出设备（ADR-0006）。
--
-- ⚠️ 安全要点（服务端实现必须在 Edge Function / trigger 里强制）：
--   1. invites：尝试次数上限（attempts >= max_attempts 即锁死）由
--      trigger 强制，不信任客户端传参
--   2. 邀请一次性：claimed 后不可再用于领取
--   3. expires_at 过期由查询侧过滤 + 定时清理任务兜底
-- ============================================================

-- ---------- 家庭 ----------

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的家庭',
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 最近一次 FDK 轮换时间（撤销成员后 needsRotation 以此为界）
  last_rotated_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 成员 ----------
-- wrapped_fdk = AES-GCM(FDK, 成员自己的 UMK, aad=`member:${userId}:${familyId}`)
-- 改密码只需重写这一行的 wrapped_fdk，业务数据不动。

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null check (role in ('owner', 'editor', 'viewer')),
  wrapped_fdk text not null,
  -- 软删：撤销成员 = 置 revoked_at + 删除 wrapped_fdk 内容（防止其重新领取）
  revoked_at timestamptz,
  joined_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create index if not exists family_members_user_idx
  on public.family_members (user_id);

create index if not exists family_members_family_idx
  on public.family_members (family_id);

-- 家庭内成员互相可见（成员列表页需要），已撤销的仅留 id/角色痕迹
alter table public.family_members enable row level security;

drop policy if exists "members visible to family" on public.family_members;
create policy "members visible to family"
  on public.family_members for select
  using (
    revoked_at is null
    and exists (
      select 1 from public.family_members me
      where me.family_id = family_members.family_id
        and me.user_id = auth.uid()
        and me.revoked_at is null
    )
  );

-- 只有 owner 能增删成员（role 变更同理）
drop policy if exists "owner manages members" on public.family_members;
create policy "owner manages members"
  on public.family_members for all
  using (
    exists (
      select 1 from public.families f
      where f.id = family_members.family_id
        and f.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.families f
      where f.id = family_members.family_id
        and f.owner_id = auth.uid()
    )
  );

-- 例外：成员本人首次加入时可以插入「自己那一行」（由邀请领取流程写入）
drop policy if exists "self join via invite" on public.family_members;
create policy "self join via invite"
  on public.family_members for insert
  with check (auth.uid() = user_id);

-- 成员可以更新自己的 wrapped_fdk（领取轮换后的新副本）
drop policy if exists "self update wrapped fdk" on public.family_members;
create policy "self update wrapped fdk"
  on public.family_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- 邀请 ----------
-- code_hash = SHA256(归一化邀请码)；服务端绝不存码明文。
-- wrapped_fdk = AES-GCM(FDK, KEK(code,salt,invite_id), aad=`invite:${invite_id}`)

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  code_hash text not null,
  salt text not null,
  wrapped_fdk text not null,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'expired', 'revoked', 'locked')),
  attempts int not null default 0,
  max_attempts int not null default 10,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  claimed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 按码哈希查找是领取流程的唯一入口
create unique index if not exists invites_code_hash_idx
  on public.invites (code_hash)
  where status = 'pending';

create index if not exists invites_family_idx
  on public.invites (family_id);

alter table public.invites enable row level security;

-- 只有该家庭的 owner 能创建/查看/作废邀请
drop policy if exists "owner manages invites" on public.invites;
create policy "owner manages invites"
  on public.invites for all
  using (
    exists (
      select 1 from public.families f
      where f.id = invites.family_id
        and f.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.families f
      where f.id = invites.family_id
        and f.owner_id = auth.uid()
    )
  );

-- 例外：任何已登录用户可以凭「码哈希」读到一条 pending 邀请的领取材料。
-- 注意 RLS 无法按「用户输入的码」过滤（查询参数不进 policy），
-- 实际按 hash 精确查询由领取 RPC（claim_invite）完成，这里放行 select
-- 并在 RPC 内校验 attempts / 过期 / 一次性。
drop policy if exists "claim requires code hash" on public.invites;
create policy "claim requires code hash"
  on public.invites for select
  using (status = 'pending' and expires_at > now());

-- ---------- 轮换 ----------
-- wrapped_new_fdk = AES-GCM(FDK_new, FDK_old, aad=`rotation:${familyId}`)
-- 只有「当前仍是成员」的人能读到（被撤销者的 family_members 行已删/已置空，
-- 下面的 exists 子查询挡住他）——这是撤销能生效的关键。

create table if not exists public.family_key_rotations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  reason text not null check (reason in ('member_removed', 'manual', 'device_lost')),
  wrapped_new_fdk text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 全部剩余成员领取完成后置 true，此时旧 FDK 可废弃
  completed_at timestamptz
);

create index if not exists rotations_family_idx
  on public.family_key_rotations (family_id);

alter table public.family_key_rotations enable row level security;

drop policy if exists "rotations visible to active members" on public.family_key_rotations;
create policy "rotations visible to active members"
  on public.family_key_rotations for select
  using (
    exists (
      select 1 from public.family_members me
      where me.family_id = family_key_rotations.family_id
        and me.user_id = auth.uid()
        and me.revoked_at is null
    )
  );

drop policy if exists "owner creates rotations" on public.family_key_rotations;
create policy "owner creates rotations"
  on public.family_key_rotations for insert
  with check (
    exists (
      select 1 from public.families f
      where f.id = family_key_rotations.family_id
        and f.owner_id = auth.uid()
    )
  );

drop policy if exists "owner completes rotations" on public.family_key_rotations;
create policy "owner completes rotations"
  on public.family_key_rotations for update
  using (
    exists (
      select 1 from public.families f
      where f.id = family_key_rotations.family_id
        and f.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.families f
      where f.id = family_key_rotations.family_id
        and f.owner_id = auth.uid()
    )
  );

-- ---------- sync_records：从「仅本人」升级为「家庭内成员可见」 ----------
-- W4 的 RLS 只覆盖单用户多设备；W5 起同一家庭的成员互相可见密文行
-- （能否解开取决于各成员手里的 FDK，服务端不参与）。

drop policy if exists "own sync rows" on public.sync_records;

drop policy if exists "family sync rows" on public.sync_records;
create policy "family sync rows"
  on public.sync_records for select
  using (
    exists (
      select 1 from public.family_members me
      where me.family_id = sync_records.family_id
        and me.user_id = auth.uid()
        and me.revoked_at is null
    )
  );

-- 写入：本人行一律允许；写别人名下的行仅 owner 可以（如代录入场景）
drop policy if exists "insert own or owner" on public.sync_records;
create policy "insert own or owner"
  on public.sync_records for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.families f
      where f.id = sync_records.family_id
        and f.owner_id = auth.uid()
    )
  );

drop policy if exists "update own or owner" on public.sync_records;
create policy "update own or owner"
  on public.sync_records for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.families f
      where f.id = sync_records.family_id
        and f.owner_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.families f
      where f.id = sync_records.family_id
        and f.owner_id = auth.uid()
    )
  );

-- ---------- 尝试次数强制锁死（trigger，不信任客户端） ----------

create or replace function public.enforce_invite_attempts()
returns trigger as $$
begin
  if new.attempts >= new.max_attempts and new.status = 'pending' then
    new.status = 'locked';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists invites_enforce_attempts on public.invites;
create trigger invites_enforce_attempts
  before update on public.invites
  for each row execute function public.enforce_invite_attempts();
