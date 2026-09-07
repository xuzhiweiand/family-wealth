-- 端到端加密同步表（W4）
--
-- 服务端只能看到：id / kind / updated_at / deleted_at / envelope(密文)
-- 金额、资产名、备注等明文一律不出设备（ADR-0006）。
-- 因此趋势聚合、冲突裁决都在客户端完成（packages/analytics、packages/sync）。
--
-- ⚠️ 当前 RLS 按 auth.uid() = user_id，覆盖「同一用户的多设备同步」。
--    跨家庭成员共享需要托管 FDK（邀请码机制，P1），届时改为按 family_id 授权。

create table if not exists public.sync_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  family_id uuid not null,
  record_id uuid not null,
  kind text not null check (kind in ('asset', 'snapshot')),
  updated_at timestamptz not null,
  deleted_at timestamptz,
  envelope text not null,
  created_at timestamptz not null default now(),
  unique (user_id, record_id)
);

create index if not exists sync_records_user_updated_idx
  on public.sync_records (user_id, updated_at);

create index if not exists sync_records_family_idx
  on public.sync_records (family_id);

alter table public.sync_records enable row level security;

drop policy if exists "own sync rows" on public.sync_records;
create policy "own sync rows" on public.sync_records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
