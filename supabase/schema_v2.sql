-- 매일 언어 — v2: 실시간 순위 · 친구 대결 · 전화번호(동의 기반) 친구 찾기
--
-- schema.sql 을 먼저 실행한 뒤 이 파일을 통째로 붙여넣고 실행하십시오.
-- 다시 실행해도 안전하도록 모두 if not exists / or replace 로 썼습니다.
--
-- 설계에서 지킨 것
--  · 전화번호는 profiles 에 두지 않습니다. 승인된 사람끼리는 서로의 profiles 행을 볼 수 있어
--    거기 두면 번호가 그대로 노출됩니다. 별도 표에 넣고 아무도 직접 읽지 못하게 막았습니다.
--  · 친구 찾기는 '번호를 이미 아는 사람만' 찾을 수 있게, 해시 일치 조회 함수로만 열었습니다.
--  · 동의 시각을 남깁니다. 동의 없이 저장된 번호는 없어야 합니다(법정 의무).

-- =========================================================
-- 1. 전화번호 (동의 기반, 해시로만 대조)
-- =========================================================

create table if not exists public.phone_index (
  user_id       uuid primary key references auth.users on delete cascade,
  phone_hash    text not null,                  -- sha256(정규화한 번호). 원본은 저장하지 않는다
  consent_at    timestamptz not null,           -- 수집·이용 동의 시각
  updated_at    timestamptz not null default now()
);

create index if not exists phone_index_hash_idx on public.phone_index (phone_hash);

alter table public.phone_index enable row level security;

-- 본인만 자기 행을 넣고·고치고·지우고·볼 수 있다. 남의 행은 조회 자체가 막힌다.
drop policy if exists "own phone read" on public.phone_index;
create policy "own phone read" on public.phone_index
  for select using (auth.uid() = user_id);

drop policy if exists "own phone write" on public.phone_index;
create policy "own phone write" on public.phone_index
  for insert with check (auth.uid() = user_id);

drop policy if exists "own phone update" on public.phone_index;
create policy "own phone update" on public.phone_index
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own phone delete" on public.phone_index;
create policy "own phone delete" on public.phone_index
  for delete using (auth.uid() = user_id);

-- 번호를 이미 아는 사람만 찾을 수 있는 조회 함수.
-- 표를 직접 읽을 수는 없고, 해시가 정확히 맞을 때만 이름과 id 를 돌려준다.
create or replace function public.find_by_phone(h text)
returns table (id uuid, name text)
language sql security definer stable set search_path = public as $$
  select p.id, p.name
    from public.phone_index x
    join public.profiles p on p.id = x.user_id
   where x.phone_hash = h
     and p.status = 'approved'
     and public.is_approved()          -- 승인된 사람만 쓸 수 있다
     and x.user_id <> auth.uid()       -- 자기 자신은 결과에서 뺀다
   limit 1;
$$;

revoke all on function public.find_by_phone(text) from public;
grant execute on function public.find_by_phone(text) to authenticated;

-- =========================================================
-- 2. 대결 (같은 언어로 기간을 정해 얻은 점수를 겨룬다)
-- =========================================================

create table if not exists public.duels (
  id           uuid primary key default gen_random_uuid(),
  lang         text not null,                    -- 'zh' | 'zh2' | 'en' | 'ja'
  challenger   uuid not null references auth.users on delete cascade,
  opponent     uuid not null references auth.users on delete cascade,
  days         integer not null default 7,
  status       text not null default 'pending',  -- pending | active | done | declined | canceled
  start_at     timestamptz,
  end_at       timestamptz,
  c_start_xp   integer,                          -- 시작 시점의 점수(이 뒤로 번 점수만 센다)
  o_start_xp   integer,
  winner       uuid,
  created_at   timestamptz not null default now()
);

create index if not exists duels_mine_idx on public.duels (challenger, status);
create index if not exists duels_theirs_idx on public.duels (opponent, status);

alter table public.duels enable row level security;

-- 당사자 둘만 보고 고칠 수 있다
drop policy if exists "duel read" on public.duels;
create policy "duel read" on public.duels
  for select using (auth.uid() = challenger or auth.uid() = opponent);

drop policy if exists "duel create" on public.duels;
create policy "duel create" on public.duels
  for insert with check (auth.uid() = challenger and public.is_approved());

drop policy if exists "duel update" on public.duels;
create policy "duel update" on public.duels
  for update using (auth.uid() = challenger or auth.uid() = opponent)
  with check (auth.uid() = challenger or auth.uid() = opponent);

drop policy if exists "duel admin read" on public.duels;
create policy "duel admin read" on public.duels
  for select using (public.is_admin());

-- 대결을 수락할 때 두 사람의 '시작 점수'를 서버가 찍는다.
-- 클라이언트가 자기 시작 점수를 낮게 적어 유리해지는 것을 막기 위해서다.
create or replace function public.accept_duel(duel_id uuid)
returns public.duels
language plpgsql security definer set search_path = public as $$
declare
  d public.duels;
  cx integer;
  ox integer;
begin
  select * into d from public.duels where id = duel_id;
  if d.id is null then raise exception 'duel not found'; end if;
  if d.opponent <> auth.uid() then raise exception 'not your duel'; end if;
  if d.status <> 'pending' then raise exception 'already handled'; end if;

  select coalesce(xp, 0) into cx from public.progress where user_id = d.challenger and lang = d.lang;
  select coalesce(xp, 0) into ox from public.progress where user_id = d.opponent  and lang = d.lang;

  update public.duels
     set status = 'active',
         start_at = now(),
         end_at = now() + (d.days || ' days')::interval,
         c_start_xp = coalesce(cx, 0),
         o_start_xp = coalesce(ox, 0)
   where id = duel_id
   returning * into d;
  return d;
end;
$$;

revoke all on function public.accept_duel(uuid) from public;
grant execute on function public.accept_duel(uuid) to authenticated;

-- 진행 중인 대결의 현재 점수. 당사자만 볼 수 있다.
create or replace function public.duel_standing(duel_id uuid)
returns table (
  id uuid, lang text, status text, days integer, end_at timestamptz,
  me_name text, you_name text,
  me_gain integer, you_gain integer, i_am_challenger boolean
)
language sql security definer stable set search_path = public as $$
  with d as (
    select * from public.duels
     where id = duel_id and (challenger = auth.uid() or opponent = auth.uid())
  ),
  cx as (select coalesce(xp,0) xp from public.progress p, d where p.user_id = d.challenger and p.lang = d.lang),
  ox as (select coalesce(xp,0) xp from public.progress p, d where p.user_id = d.opponent  and p.lang = d.lang)
  select d.id, d.lang, d.status, d.days, d.end_at,
         (select name from public.profiles where id = auth.uid()),
         (select name from public.profiles
           where id = case when d.challenger = auth.uid() then d.opponent else d.challenger end),
         case when d.challenger = auth.uid()
              then coalesce((select xp from cx),0) - coalesce(d.c_start_xp,0)
              else coalesce((select xp from ox),0) - coalesce(d.o_start_xp,0) end,
         case when d.challenger = auth.uid()
              then coalesce((select xp from ox),0) - coalesce(d.o_start_xp,0)
              else coalesce((select xp from cx),0) - coalesce(d.c_start_xp,0) end,
         (d.challenger = auth.uid())
    from d;
$$;

revoke all on function public.duel_standing(uuid) from public;
grant execute on function public.duel_standing(uuid) to authenticated;

-- 기간이 끝난 대결을 마감한다(누가 열어 보든 한 번만 확정된다)
create or replace function public.close_duel(duel_id uuid)
returns public.duels
language plpgsql security definer set search_path = public as $$
declare
  d public.duels;
  cg integer; og integer;
begin
  select * into d from public.duels
   where id = duel_id and (challenger = auth.uid() or opponent = auth.uid());
  if d.id is null then raise exception 'duel not found'; end if;
  if d.status <> 'active' then return d; end if;
  if d.end_at > now() then return d; end if;

  select coalesce(xp,0) - coalesce(d.c_start_xp,0) into cg
    from public.progress where user_id = d.challenger and lang = d.lang;
  select coalesce(xp,0) - coalesce(d.o_start_xp,0) into og
    from public.progress where user_id = d.opponent and lang = d.lang;

  update public.duels
     set status = 'done',
         winner = case when coalesce(cg,0) > coalesce(og,0) then d.challenger
                       when coalesce(og,0) > coalesce(cg,0) then d.opponent
                       else null end          -- 같으면 무승부
   where id = duel_id
   returning * into d;
  return d;
end;
$$;

revoke all on function public.close_duel(uuid) from public;
grant execute on function public.close_duel(uuid) to authenticated;

-- =========================================================
-- 3. 실시간 — 남이 공부하면 내 순위표가 바로 움직인다
--    (행 수준 보안은 그대로 적용된다. 승인된 사람만 받는다)
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'progress'
  ) then
    alter publication supabase_realtime add table public.progress;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'duels'
  ) then
    alter publication supabase_realtime add table public.duels;
  end if;
end $$;

-- =========================================================
-- 4. 확인용
-- =========================================================
-- select * from public.duels order by created_at desc;
-- select count(*) from public.phone_index;      -- 번호를 등록한 사람 수(내용은 안 보인다)
