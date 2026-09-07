-- ============================================================
-- W3 迁移：profiles 表（存服务端 salt + 密码校验信封）
--
-- 端到端加密架构（ADR-0006）：
--   - salt：per-user 服务端 salt（16B，base64），用于本地重派生 UMK
--   - password_check_envelope：用 UMK 加密的固定明文（base64），
--     登录时客户端解密校验「密码 → UMK」派生是否正确
--
-- 说明：Supabase Auth 只托管身份与会话，不存加密相关字段，
--      故单独建表。RLS 限制仅本人可读写。
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  -- 服务端 salt（base64）
  salt text not null,
  -- 密码校验信封（base64 JSON，见 packages/crypto/src/password-check.ts）
  password_check_envelope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 更新时间触发器
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS：仅本人可读
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- RLS：仅本人可写（注册时客户端 upsert，登录后不可由他人改）
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
