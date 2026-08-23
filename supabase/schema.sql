-- 매일 언어 — 계정·승인·진도 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행하십시오. 한 번만 하면 됩니다.
-- (다시 실행해도 안전하도록 모두 if not exists / or replace 로 썼습니다)

-- =========================================================
-- 1. 표
-- =========================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  name        text,
  status      text not null default 'pending',   -- pending | approved | blocked
  role        text not null default 'member',    -- member | admin
  note        text,                              -- 관리자 메모(누가 소개했는지 등)
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid
);

create table if not exists public.progress (
  user_id    uuid not null references auth.users on delete cascade,
  lang       text not null,                      -- 'zh' | 'en'
  data       jsonb not null default '{}'::jsonb, -- 앱의 진도 뭉치
  xp         integer not null default 0,
  streak     integer not null default 0,
  done_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, lang)
);

create index if not exists progress_rank_idx on public.progress (lang, xp desc);

-- =========================================================
-- 2. 권한 판정 함수
--    RLS 정책 안에서 profiles 를 다시 조회하면 무한 재귀가 납니다.
--    security definer 함수로 감싸 그 문제를 피합니다.
-- =========================================================

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_approved()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- =========================================================
-- 3. 가입하면 프로필이 자동으로 생기고, 상태는 '승인 대기'
-- =========================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  -- 맨 처음 가입한 사람은 관리자로 만들고 바로 승인한다.
  -- (그래야 관리자를 만들려고 SQL 을 또 실행하지 않아도 된다)
  -- ⚠️ 그러므로 이 표를 만든 뒤 **대표님이 가장 먼저** 가입하셔야 합니다.
  select not exists (select 1 from public.profiles) into first_user;

  insert into public.profiles (id, email, name, role, status, approved_at)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when first_user then 'admin'  else 'member'  end,
    case when first_user then 'approved' else 'pending' end,
    case when first_user then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- 4. 행 수준 보안
-- =========================================================

alter table public.profiles enable row level security;
alter table public.progress enable row level security;

-- profiles ------------------------------------------------
drop policy if exists "self read" on public.profiles;
create policy "self read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "self update name" on public.profiles;
create policy "self update name" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "approved can see approved" on public.profiles;
create policy "approved can see approved" on public.profiles
  for select using (status = 'approved' and public.is_approved());

drop policy if exists "admin read all" on public.profiles;
create policy "admin read all" on public.profiles
  for select using (public.is_admin());

drop policy if exists "admin update all" on public.profiles;
create policy "admin update all" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- progress ------------------------------------------------
drop policy if exists "own progress read" on public.progress;
create policy "own progress read" on public.progress
  for select using (auth.uid() = user_id);

drop policy if exists "own progress write" on public.progress;
create policy "own progress write" on public.progress
  for insert with check (auth.uid() = user_id and public.is_approved());

drop policy if exists "own progress update" on public.progress;
create policy "own progress update" on public.progress
  for update using (auth.uid() = user_id and public.is_approved())
  with check (auth.uid() = user_id);

-- 승인된 사람끼리는 서로의 점수를 볼 수 있다(친구 순위표)
drop policy if exists "approved read ranking" on public.progress;
create policy "approved read ranking" on public.progress
  for select using (public.is_approved());

drop policy if exists "admin read progress" on public.progress;
create policy "admin read progress" on public.progress
  for select using (public.is_admin());

-- =========================================================
-- 5. 순위표 (이름 + 점수만. 학습 내용 자체는 내려주지 않는다)
-- =========================================================

create or replace view public.leaderboard
with (security_invoker = on) as
  select p.id, p.name, g.lang, g.xp, g.streak, g.done_count, g.updated_at
  from public.progress g
  join public.profiles p on p.id = g.user_id
  where p.status = 'approved';

-- =========================================================
-- 6. 관리자
--    맨 처음 가입한 사람이 자동으로 관리자가 됩니다(위 트리거).
--    그러니 이 SQL 을 실행한 뒤 **대표님이 가장 먼저** 앱에서 가입하십시오.
--
--    혹시 다른 사람이 먼저 가입해 버렸다면, 아래 한 줄로 바로잡을 수 있습니다.
--    (아이디가 coqss1 이면 이메일은 coqss1@lang-daily.local 입니다)
-- =========================================================

-- update public.profiles
--    set role = 'admin', status = 'approved', approved_at = now()
--  where email = 'coqss1@lang-daily.local';

-- 지금 누가 관리자인지 보려면:
-- select name, email, role, status, created_at from public.profiles order by created_at;
