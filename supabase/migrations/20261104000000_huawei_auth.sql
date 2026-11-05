-- ============================================================
-- v0.5.0 迁移：华为账号（Account Kit 授权登录）身份关联
--
-- 设计：
--   - OpenID 是华为账号在单个应用内的稳定标识（同一账号跨设备一致）
--   - 一个 Supabase 用户最多关联一个华为 OpenID，一个 OpenID 只能关联一个用户
--   - 加密档案仍保存在 profiles（salt / password_check_envelope），本表只管身份
--
-- 写入方：
--   - 仅 huawei-auth Edge Function（Service Role）可写
--   - 登录用户只能读取与自己关联的一行
-- ============================================================

create table if not exists public.profiles_huawei (
  open_id text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  union_id text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create index if not exists profiles_huawei_user_id_idx
  on public.profiles_huawei (user_id);

alter table public.profiles_huawei enable row level security;

drop policy if exists "profiles_huawei_select_own" on public.profiles_huawei;
create policy "profiles_huawei_select_own"
  on public.profiles_huawei for select
  using (auth.uid() = user_id);

-- 不开放 INSERT / UPDATE / DELETE：统一由 huawei-auth 以 Service Role 写入
