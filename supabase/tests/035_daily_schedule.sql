-- Phase 4 (#67): daily schedule snapshots and the timezone-change limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(105);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Today in UTC, and a weekday n days ago.
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'UTC')::date $$;
create function pg_temp.dow_ago(n int) returns smallint language sql as $$
  select extract(dow from pg_temp.today() - n)::smallint $$;
create function pg_temp.sched(p_uid uuid, p_day date) returns int language sql as $$
  select scheduled_count from public.daily_schedule where user_id = p_uid and local_date = p_day $$;
create function pg_temp.has(p_uid uuid, p_day date, p_habit uuid) returns boolean language sql as $$
  select exists (select 1 from public.daily_schedule_habits
                 where user_id = p_uid and local_date = p_day and habit_id = p_habit) $$;

-- Users: profiles come from the signup trigger.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),  -- onboarded 10 days ago
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),    -- onboarded 2 days ago
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),  -- not onboarded
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),   -- timezone changes
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com');   -- east/west jumps

-- Habits are created while users aren't onboarded yet, so inserting them
-- doesn't snapshot anything; then onboarding is backdated.
insert into public.habits (id, user_id, title, category, days_of_week, created_at) values
  -- Alice: a1 daily; a2 only on the weekday 2 days ago; a3 not today's weekday.
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Daily', 'mind',
   '{0,1,2,3,4,5,6}', now() - interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Once a week', 'fitness',
   array[pg_temp.dow_ago(2)], now() - interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Not today', 'health',
   array[pg_temp.dow_ago(1)], now() - interval '10 days'),
  -- Bob: daily, created long before he onboarded.
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Read', 'learning',
   '{0,1,2,3,4,5,6}', now() - interval '10 days'),
  ('eeeeeeee-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Stretch', 'fitness',
   '{0,1,2,3,4,5,6}', now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Walk', 'fitness',
   '{0,1,2,3,4,5,6}', now() - interval '10 days');
-- Alice's archived habit (archived 3 days ago) for the unarchive case.
insert into public.habits (id, user_id, title, category, created_at, archived_at) values
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Old', 'other',
   now() - interval '10 days', now() - interval '3 days');

update public.profiles set onboarded_at = now() - interval '10 days', timezone = 'UTC'
  where id in ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
update public.profiles set onboarded_at = now() - interval '2 days', timezone = 'UTC'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set onboarded_at = now() - interval '10 days', timezone = 'Etc/GMT+12'
  where id = '55555555-5555-5555-5555-555555555555';

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'ensure_daily_schedule', array['uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call ensure_daily_schedule');
select function_privs_are('public', 'ensure_daily_schedule', array['uuid', 'timestamp with time zone'],
  'service_role', array[]::text[], 'service_role cannot call ensure_daily_schedule');
select function_privs_are('public', 'snapshot_add_habit', array['uuid', 'uuid', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call snapshot_add_habit');
select function_privs_are('public', 'local_date_in', array['text', 'timestamp with time zone'],
  'authenticated', array[]::text[], 'clients cannot call local_date_in');
select function_privs_are('public', 'habits_after_write', array[]::text[],
  'authenticated', array[]::text[], 'clients cannot call the after trigger');
select is_definer('public', 'ensure_daily_schedule', array['uuid', 'timestamp with time zone'],
  'ensure_daily_schedule is SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.ensure_daily_schedule(uuid, timestamptz)'::regprocedure),
  'ensure_daily_schedule pins an empty search_path');
select column_privs_are('public', 'profiles', 'timezone_changed_at', 'authenticated', array['SELECT'],
  'clients can read but not write timezone_changed_at');

-- ── Backfill ────────────────────────────────────────────────────────────────
select is(public.ensure_daily_schedule('11111111-1111-1111-1111-111111111111', now()),
  pg_temp.today(), 'ensure returns today''s local date');
select is((select count(*)::int from public.daily_schedule
           where user_id = '11111111-1111-1111-1111-111111111111'), 8,
  'today plus the 7-day lookback are snapshotted');
select is((select min(local_date) from public.daily_schedule
           where user_id = '11111111-1111-1111-1111-111111111111'), pg_temp.today() - 7,
  'nothing older than the lookback');
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today() - 2), 2,
  'the day 2 days ago had both the daily and the weekly habit');
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today() - 6), 2,
  'a plain day had the daily habit and the not-yet-archived one');
select ok(not pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                          'aaaaaaaa-0000-0000-0000-000000000003'),
  'a habit not scheduled on today''s weekday isn''t in today''s snapshot');
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today() - 4,
                      'aaaaaaaa-0000-0000-0000-000000000004'),
  'a habit archived 3 days ago was still scheduled before that');
select ok(not pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today() - 2,
                          'aaaaaaaa-0000-0000-0000-000000000004'),
  'and not after it was archived');
select is((select difficulty::text from public.daily_schedule_habits
           where user_id = '11111111-1111-1111-1111-111111111111' and local_date = pg_temp.today()
             and habit_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'medium',
  'the snapshot records the difficulty');

select public.ensure_daily_schedule('22222222-2222-2222-2222-222222222222', now());
select is((select min(local_date) from public.daily_schedule
           where user_id = '22222222-2222-2222-2222-222222222222'), pg_temp.today() - 2,
  'never before the onboarding date, even for older habits');
select is((select count(*)::int from public.daily_schedule
           where user_id = '22222222-2222-2222-2222-222222222222'), 3, 'Bob has 3 days');

select public.ensure_daily_schedule('33333333-3333-3333-3333-333333333333', now());
select is((select count(*)::int from public.daily_schedule
           where user_id = '33333333-3333-3333-3333-333333333333'), 0,
  'nothing is snapshotted before onboarding');

-- Calling again changes nothing.
update public.daily_schedule set scheduled_count = 7
  where user_id = '11111111-1111-1111-1111-111111111111' and local_date = pg_temp.today() - 5;
select public.ensure_daily_schedule('11111111-1111-1111-1111-111111111111', now());
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today() - 5), 7,
  'existing days are never rewritten');

-- ── Edits after a missed day don't change it (the anti-cheat) ──────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.habits set days_of_week = array[pg_temp.dow_ago(1)]
  where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select pg_temp.as_postgres();
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today() - 2), 2,
  'removing a missed day''s weekday leaves that day scheduled');
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today() - 2,
                      'aaaaaaaa-0000-0000-0000-000000000002'),
  'and the habit stays in its snapshot');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.archive_habit('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.as_postgres();
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                      'aaaaaaaa-0000-0000-0000-000000000001'),
  'archiving a habit today leaves it in today''s snapshot');
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today()), 1,
  'today''s scheduled_count doesn''t fall when a habit is archived');

-- A user who skipped days, then edits: the missing days are snapshotted with
-- the old schedule first.
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'fay@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('ffffffff-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'Floss', 'self_care',
   now() - interval '5 days');
update public.profiles set onboarded_at = now() - interval '5 days'
  where id = '66666666-6666-6666-6666-666666666666';
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
update public.habits set days_of_week = array[pg_temp.dow_ago(-1)]
  where id = 'ffffffff-0000-0000-0000-000000000001';
select pg_temp.as_postgres();
select is(pg_temp.sched('66666666-6666-6666-6666-666666666666', pg_temp.today() - 3), 1,
  'an edit snapshots the missed days with the old schedule first');
select is(pg_temp.sched('66666666-6666-6666-6666-666666666666', pg_temp.today()), 1,
  'and today, before the edit takes effect');

select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
update public.habits set difficulty = 'hard', target_per_day = 3
  where id = 'ffffffff-0000-0000-0000-000000000001';
select pg_temp.as_postgres();
select is((select difficulty::text || '/' || target_per_day from public.daily_schedule_habits
           where user_id = '66666666-6666-6666-6666-666666666666' and local_date = pg_temp.today()),
  'medium/1', 'difficulty and target edits apply from tomorrow');

-- ── Additions during the day ────────────────────────────────────────────────
-- As postgres, to fix the id; the triggers run the same for every role.
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'New today', 'mind');
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                      'aaaaaaaa-0000-0000-0000-000000000005'),
  'a habit created today joins today''s snapshot');
select is(pg_temp.sched('11111111-1111-1111-1111-111111111111', pg_temp.today()), 1,
  'but doesn''t raise scheduled_count (a rest day stays a rest day)');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.unarchive_habit('aaaaaaaa-0000-0000-0000-000000000004');
select pg_temp.as_postgres();
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                      'aaaaaaaa-0000-0000-0000-000000000004'),
  'an unarchived habit joins today''s snapshot');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.habits set days_of_week = '{0,1,2,3,4,5,6}'
  where id = 'aaaaaaaa-0000-0000-0000-000000000003';
select pg_temp.as_postgres();
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                      'aaaaaaaa-0000-0000-0000-000000000003'),
  'adding today''s weekday to a habit adds it to today''s snapshot');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
update public.habits set days_of_week = array[pg_temp.dow_ago(1)]
  where id = 'aaaaaaaa-0000-0000-0000-000000000005';
select pg_temp.as_postgres();
select ok(pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                      'aaaaaaaa-0000-0000-0000-000000000005'),
  'removing today''s weekday doesn''t remove it from today''s snapshot');

-- Cap: with a cap of the current size, nothing more joins.
update public.economy_config set value = (
  select count(*) from public.daily_schedule_habits
  where user_id = '11111111-1111-1111-1111-111111111111' and local_date = pg_temp.today())::text::jsonb
  where key = 'schedule_max_habits';
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Over the cap', 'mind');
select ok(not pg_temp.has('11111111-1111-1111-1111-111111111111', pg_temp.today(),
                          'aaaaaaaa-0000-0000-0000-000000000006'),
  'nothing joins today''s snapshot past the cap');
update public.economy_config set value = '20' where key = 'schedule_max_habits';

-- ── Creation limits come from economy_config ────────────────────────────────
update public.economy_config set value = '{"per_day": 2, "per_30_days": 100}'
  where key = 'habit_create_limits';
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select lives_ok($$insert into public.habits (title, category) values ('One', 'mind'), ('Two', 'mind')$$,
  'up to the configured daily limit');
select throws_ok($$insert into public.habits (title, category) values ('Three', 'mind')$$,
  'QX001', 'You can create at most 2 habits a day', 'the daily limit is read from config');
select pg_temp.as_postgres();
update public.economy_config set value = '{"per_day": 30, "per_30_days": 100}'
  where key = 'habit_create_limits';

-- ── Timezone changes (#28) ──────────────────────────────────────────────────
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select lives_ok($$update public.profiles set timezone = 'Europe/London'
                  where id = '44444444-4444-4444-4444-444444444444'$$,
  'an onboarded user can change their timezone');
select pg_temp.as_postgres();
select is((select timezone_changed_at from public.profiles
           where id = '44444444-4444-4444-4444-444444444444'), now(), 'the change is stamped');
select ok(exists (select 1 from public.daily_schedule
                  where user_id = '44444444-4444-4444-4444-444444444444'
                    and local_date = pg_temp.today()),
  'the old timezone''s day is snapshotted before the change');
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select throws_ok($$update public.profiles set timezone = 'Asia/Tokyo'
                   where id = '44444444-4444-4444-4444-444444444444'$$,
  'QX001', 'You can change your timezone once every 7 days', 'a second change within 7 days is refused');
select lives_ok($$update public.profiles set display_name = 'Dave'
                  where id = '44444444-4444-4444-4444-444444444444'$$,
  'other profile edits are unaffected by the cooldown');
select throws_ok($$update public.profiles set timezone_changed_at = null
                   where id = '44444444-4444-4444-4444-444444444444'$$,
  '42501', null, 'a client can''t reset the cooldown');
select pg_temp.as_postgres();
update public.profiles set timezone_changed_at = now() - interval '8 days'
  where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select lives_ok($$update public.profiles set timezone = 'Asia/Tokyo'
                  where id = '44444444-4444-4444-4444-444444444444'$$,
  'after the cooldown, the timezone can change again');
select pg_temp.as_postgres();

-- Onboarding is exempt: Carol isn't onboarded.
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select lives_ok($$update public.profiles set timezone = 'Asia/Tokyo'
                  where id = '33333333-3333-3333-3333-333333333333'$$, 'a change during onboarding is free');
select lives_ok($$update public.profiles set timezone = 'Europe/Paris'
                  where id = '33333333-3333-3333-3333-333333333333'$$, 'even twice');
select pg_temp.as_postgres();
select is((select timezone_changed_at from public.profiles
           where id = '33333333-3333-3333-3333-333333333333'), null,
  'and doesn''t start the cooldown');

-- East: Erin counted today in UTC-12, then jumps to UTC+14.
update public.profiles set last_streak_date = public.local_date_in('Etc/GMT+12', now())
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
update public.profiles set timezone = 'Pacific/Kiritimati'
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_postgres();
select is((select last_streak_date from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  public.local_date_in('Pacific/Kiritimati', now()),
  'moving east, the new local day inherits the counted day (no extra streak day)');
select ok(public.local_date_in('Pacific/Kiritimati', now()) > public.local_date_in('Etc/GMT+12', now()),
  '(the jump really did move the local date forward)');

-- West: back from UTC+14 to UTC-12 a cooldown later; last_streak_date stays.
update public.profiles set timezone_changed_at = now() - interval '8 days'
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
update public.profiles set timezone = 'Etc/GMT+12'
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_postgres();
select is((select last_streak_date from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  public.local_date_in('Pacific/Kiritimati', now()),
  'moving west leaves last_streak_date alone (rule 0 handles it)');

-- East without a counted day today: nothing is inherited.
update public.profiles set timezone_changed_at = now() - interval '8 days',
                           last_streak_date = public.local_date_in('Etc/GMT+12', now()) - 3
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
update public.profiles set timezone = 'Pacific/Kiritimati'
  where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.as_postgres();
select is((select last_streak_date from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  public.local_date_in('Etc/GMT+12', now()) - 3,
  'moving east with a scheduled day still pending changes nothing (it stays a miss)');

-- An unknown timezone is still rejected before anything else.
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select throws_ok($$update public.profiles set timezone = 'Mars/Olympus'
                   where id = '66666666-6666-6666-6666-666666666666'$$,
  '22023', 'Unknown timezone: Mars/Olympus', 'unknown timezones are rejected');
select pg_temp.as_postgres();

-- ── Phase 3 behaviour still holds ───────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$select public.reorder_habits(array(
  select id from public.habits where archived_at is null order by sort_order desc))$$,
  'reorder still works and doesn''t touch schedules');
select pg_temp.as_postgres();
select is((select count(*)::int from public.daily_schedule
           where user_id = '11111111-1111-1111-1111-111111111111'), 8,
  'reorder created no schedule rows');

-- ── More privileges ─────────────────────────────────────────────────────────
select function_privs_are('public', 'ensure_daily_schedule', array['uuid', 'timestamp with time zone'],
  'anon', array[]::text[], 'anon cannot call ensure_daily_schedule');
select function_privs_are('public', 'snapshot_add_habit', array['uuid', 'uuid', 'timestamp with time zone'],
  'service_role', array[]::text[], 'service_role cannot call snapshot_add_habit');
select function_privs_are('public', 'local_date_in', array['text', 'timestamp with time zone'],
  'service_role', array[]::text[], 'service_role cannot call local_date_in');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc
           where oid in ('public.snapshot_add_habit(uuid, uuid, timestamptz)'::regprocedure,
                         'public.local_date_in(text, timestamptz)'::regprocedure,
                         'public.habits_after_write()'::regprocedure,
                         'public.habits_before_write()'::regprocedure,
                         'public.profiles_validate()'::regprocedure)),
  'every new or replaced function pins an empty search_path');

select throws_ok($$select public.ensure_daily_schedule('deadbeef-0000-0000-0000-000000000000', now())$$,
  'P0002', 'Profile not found', 'ensure_daily_schedule rejects an unknown user');

-- ── DST in a non-UTC timezone (America/Toronto) ─────────────────────────────
-- 2026-03-08: 02:00 EST -> 03:00 EDT. 2026-11-01: 02:00 EDT -> 01:00 EST.
select is(array[public.local_date_in('America/Toronto', '2026-03-08 06:59:59+00'),
                public.local_date_in('America/Toronto', '2026-03-09 03:59:59+00'),
                public.local_date_in('America/Toronto', '2026-03-09 04:00:00+00')],
  array['2026-03-08', '2026-03-08', '2026-03-09']::date[],
  'local_date_in: spring-forward day ends at 04:00Z (EDT), not 05:00Z');
select is(array[public.local_date_in('America/Toronto', '2026-11-01 03:59:59+00'),
                public.local_date_in('America/Toronto', '2026-11-01 05:30:00+00'),
                public.local_date_in('America/Toronto', '2026-11-01 06:30:00+00'),
                public.local_date_in('America/Toronto', '2026-11-02 04:59:59+00'),
                public.local_date_in('America/Toronto', '2026-11-02 05:00:00+00')],
  array['2026-10-31', '2026-11-01', '2026-11-01', '2026-11-01', '2026-11-02']::date[],
  'local_date_in: fall-back day has a repeated hour and ends at 05:00Z (EST)');

-- Gus lives in Toronto and onboarded on 2026-03-05. Habits are inserted
-- before onboarding (no snapshot), with timestamps on the local-midnight edges.
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'gus@example.com');
insert into public.habits (id, user_id, title, category, days_of_week, created_at, archived_at) values
  -- g1 daily; g5 Mon-Sat (2026-03-08 is a Sunday).
  ('0a000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'G1', 'mind',
   '{0,1,2,3,4,5,6}', '2026-03-01 12:00+00', null),
  ('0a000000-0000-0000-0000-000000000005', '77777777-7777-7777-7777-777777777777', 'G5', 'mind',
   '{1,2,3,4,5,6}', '2026-03-01 12:00+00', null),
  -- g2 created exactly at local midnight 2026-03-09 (EDT); g3 one second earlier.
  ('0a000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'G2', 'mind',
   '{0,1,2,3,4,5,6}', '2026-03-09 04:00:00+00', null),
  ('0a000000-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777', 'G3', 'mind',
   '{0,1,2,3,4,5,6}', '2026-03-09 03:59:59+00', null),
  -- g4 archived exactly at local midnight 2026-03-09; g6 one second earlier.
  ('0a000000-0000-0000-0000-000000000004', '77777777-7777-7777-7777-777777777777', 'G4', 'mind',
   '{0,1,2,3,4,5,6}', '2026-03-01 12:00+00', '2026-03-09 04:00:00+00'),
  ('0a000000-0000-0000-0000-000000000006', '77777777-7777-7777-7777-777777777777', 'G6', 'mind',
   '{0,1,2,3,4,5,6}', '2026-03-01 12:00+00', '2026-03-09 03:59:59+00');
update public.profiles set onboarded_at = '2026-03-05 12:00+00', timezone = 'America/Toronto'
  where id = '77777777-7777-7777-7777-777777777777';

-- 03:30Z on 03-10 is still 23:30 on 03-09 in Toronto. The session timezone
-- also observes the DST change, so generate_series crosses it.
set local timezone = 'America/Toronto';
select is(public.ensure_daily_schedule('77777777-7777-7777-7777-777777777777', '2026-03-10 03:30+00'),
  '2026-03-09'::date, 'Toronto: ensure returns the local date, not the UTC one');
reset timezone;
select is((select array_agg(local_date order by local_date) from public.daily_schedule
           where user_id = '77777777-7777-7777-7777-777777777777'),
  array['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']::date[],
  'Toronto: backfill across spring-forward has no gap or duplicate day');
select ok(pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-08',
                      '0a000000-0000-0000-0000-000000000003'),
  'a habit created at 23:59:59 local on the DST day is scheduled that day');
select ok(not pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-08',
                          '0a000000-0000-0000-0000-000000000002'),
  'a habit created at local midnight is not scheduled the day before');
select ok(pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-09',
                      '0a000000-0000-0000-0000-000000000002'),
  'a habit created at local midnight is scheduled that day');
select ok(pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-09',
                      '0a000000-0000-0000-0000-000000000004'),
  'a habit archived at local midnight is still scheduled that day');
select ok(pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-08',
                      '0a000000-0000-0000-0000-000000000006'),
  'a habit archived at 23:59:59 local is scheduled that day');
select ok(not pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-09',
                          '0a000000-0000-0000-0000-000000000006'),
  'but not the next day');
select ok(not pg_temp.has('77777777-7777-7777-7777-777777777777', '2026-03-08',
                          '0a000000-0000-0000-0000-000000000005'),
  'a past day outside a habit''s days_of_week is not snapshotted for it');
select is(array[pg_temp.sched('77777777-7777-7777-7777-777777777777', '2026-03-08'),
                pg_temp.sched('77777777-7777-7777-7777-777777777777', '2026-03-09')],
  array[4, 5], 'Toronto: scheduled_count on the DST day and the day after');

-- Fall back: 04:30Z on 11-02 is 23:30 EST on 11-01 (a Sunday).
set local timezone = 'America/Toronto';
select is(public.ensure_daily_schedule('77777777-7777-7777-7777-777777777777', '2026-11-02 04:30+00'),
  '2026-11-01'::date, 'Toronto: ensure returns the local date on the fall-back day');
reset timezone;
select is((select count(*)::int from public.daily_schedule
           where user_id = '77777777-7777-7777-7777-777777777777'
             and local_date between '2026-10-25' and '2026-11-01'), 8,
  'Toronto: backfill across fall-back fills exactly lookback + 1 days');
select is(pg_temp.sched('77777777-7777-7777-7777-777777777777', '2026-11-01'), 3,
  'Toronto: the fall-back Sunday has the daily habits only');

-- ── Onboarding step 1 still works through the replaced profiles_validate ────
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'hal@example.com');
insert into public.habits (user_id, title, category, created_at) values
  ('88888888-8888-8888-8888-888888888888', 'Hal habit', 'mind', now() - interval '1 day');
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');
update public.profiles set username = 'hal_new', timezone = 'Asia/Tokyo'
  where id = '88888888-8888-8888-8888-888888888888';
select pg_temp.as_postgres();
select is((select (onboarded_at, timezone, timezone_changed_at)::text from public.profiles
           where id = '88888888-8888-8888-8888-888888888888'),
  (now(), 'Asia/Tokyo', null::timestamptz)::text,
  'username + timezone in one update onboards, without starting the cooldown');
select is((select count(*)::int from public.daily_schedule
           where user_id = '88888888-8888-8888-8888-888888888888'), 0,
  'the onboarding update itself takes no snapshot (D5)');
select pg_temp.as_user('88888888-8888-8888-8888-888888888888');
select throws_ok($$update public.profiles set username = 'admin'
                   where id = '88888888-8888-8888-8888-888888888888'$$,
  '23514', 'That username is reserved', 'reserved usernames are still rejected');
select pg_temp.as_postgres();

-- ── A blocked second timezone change leaves the first one's stamp ───────────
insert into auth.users (id, email) values ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'jon@example.com');
update public.profiles set onboarded_at = now() - interval '10 days', timezone = 'Europe/London'
  where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
update public.profiles set timezone_changed_at = now() - interval '2 days'
  where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
select pg_temp.as_user('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0');
select throws_ok($$update public.profiles set timezone = 'Asia/Tokyo'
                   where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'$$,
  'QX001', 'You can change your timezone once every 7 days', 'a change 2 days after the last is refused');
select pg_temp.as_postgres();
select is((select (timezone, timezone_changed_at)::text from public.profiles
           where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'),
  ('Europe/London', now() - interval '2 days')::text,
  'the refused change leaves the timezone and the first stamp unchanged');
select is((select count(*)::int from public.daily_schedule
           where user_id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'), 0,
  'the refused change takes no snapshot');
update public.profiles set timezone_changed_at = now() - interval '7 days'
  where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
select pg_temp.as_user('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0');
select lives_ok($$update public.profiles set timezone = 'Asia/Tokyo'
                  where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'$$,
  'exactly 7 days after the last change is allowed');
select pg_temp.as_postgres();
select is((select timezone_changed_at from public.profiles
           where id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0'), now(), 'and restamps');

-- ── Archive and unarchive on the same day; starter habits ───────────────────
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'ivy@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('0b000000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'I1', 'mind',
   now() - interval '10 days'),
  ('0b000000-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999', 'I2', 'mind',
   now() - interval '10 days');
update public.profiles set onboarded_at = now() - interval '10 days'
  where id = '99999999-9999-9999-9999-999999999999';
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select public.archive_habit('0b000000-0000-0000-0000-000000000001');
select public.unarchive_habit('0b000000-0000-0000-0000-000000000001');
select public.archive_habit('0b000000-0000-0000-0000-000000000002');
select pg_temp.as_postgres();
select is((select count(*)::int from public.daily_schedule_habits
           where user_id = '99999999-9999-9999-9999-999999999999' and local_date = pg_temp.today()
             and habit_id = '0b000000-0000-0000-0000-000000000001'), 1,
  'archive then unarchive the same day keeps exactly one snapshot row');
select is(pg_temp.sched('99999999-9999-9999-9999-999999999999', pg_temp.today()), 2,
  'archive/unarchive doesn''t change today''s scheduled_count');

-- Starter habits arrive in one multi-row insert.
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
insert into public.habits (title, category, template_key) values
  ('Starter A', 'mind', 'starter_a'), ('Starter B', 'fitness', 'starter_b'),
  ('Starter C', 'health', 'starter_c');
select pg_temp.as_postgres();
select is((select count(*)::int from public.daily_schedule_habits sh
           join public.habits h on h.id = sh.habit_id
           where sh.user_id = '99999999-9999-9999-9999-999999999999'
             and sh.local_date = pg_temp.today() and h.template_key like 'starter\_%'), 3,
  'every row of a multi-row insert joins today''s snapshot');
select is(pg_temp.sched('99999999-9999-9999-9999-999999999999', pg_temp.today()), 2,
  'and scheduled_count stays fixed');

-- The cap holds within one multi-row statement.
update public.economy_config set value = (
  select count(*) + 2 from public.daily_schedule_habits
  where user_id = '99999999-9999-9999-9999-999999999999' and local_date = pg_temp.today())::text::jsonb
  where key = 'schedule_max_habits';
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
insert into public.habits (title, category, template_key) values
  ('Cap A', 'mind', 'cap_a'), ('Cap B', 'mind', 'cap_b'), ('Cap C', 'mind', 'cap_c');
select pg_temp.as_postgres();
select is((select count(*)::int from public.daily_schedule_habits sh
           join public.habits h on h.id = sh.habit_id
           where sh.user_id = '99999999-9999-9999-9999-999999999999'
             and sh.local_date = pg_temp.today() and h.template_key like 'cap\_%'), 2,
  'a multi-row insert can''t push today''s snapshot past the cap');
update public.economy_config set value = '20' where key = 'schedule_max_habits';

-- The daily creation limit holds within one multi-row statement.
update public.economy_config set value = jsonb_build_object('per_day', (
  select count(*) + 2 from public.habits
  where user_id = '99999999-9999-9999-9999-999999999999' and created_at > now() - interval '24 hours'),
  'per_30_days', 100)
  where key = 'habit_create_limits';
select pg_temp.as_user('99999999-9999-9999-9999-999999999999');
select throws_ok($$insert into public.habits (title, category, template_key) values
                   ('Over A', 'mind', 'over_a'), ('Over B', 'mind', 'over_b'), ('Over C', 'mind', 'over_c')$$,
  'QX001', null, 'a multi-row insert can''t exceed the daily creation limit');
select pg_temp.as_postgres();
select is((select count(*)::int from public.habits where template_key like 'over\_%'), 0,
  'and none of its rows are kept');
update public.economy_config set value = '{"per_day": 30, "per_30_days": 100}'
  where key = 'habit_create_limits';

-- Tomorrow: the unarchived habit and today's additions count; the archived one doesn't.
select public.ensure_daily_schedule('99999999-9999-9999-9999-999999999999', now() + interval '1 day');
select ok(pg_temp.has('99999999-9999-9999-9999-999999999999', pg_temp.today() + 1,
                      '0b000000-0000-0000-0000-000000000001'),
  'a habit unarchived the same day is scheduled tomorrow');
select ok(not pg_temp.has('99999999-9999-9999-9999-999999999999', pg_temp.today() + 1,
                          '0b000000-0000-0000-0000-000000000002'),
  'a habit archived today is not scheduled tomorrow');
select is(pg_temp.sched('99999999-9999-9999-9999-999999999999', pg_temp.today() + 1), 7,
  'habits added today count from tomorrow');

-- ── service_role writes habits directly ─────────────────────────────────────
insert into auth.users (id, email) values ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', 'kim@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('0c000000-0000-0000-0000-000000000001', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', 'K1', 'mind',
   now() - interval '10 days');
update public.profiles set onboarded_at = now() - interval '10 days'
  where id = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0';
set local role service_role;
select lives_ok($$insert into public.habits (id, user_id, title, category) values
  ('0c000000-0000-0000-0000-000000000002', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', 'K2', 'mind')$$,
  'service_role can insert a habit for an onboarded user (economy_value runs as the definer)');
select lives_ok($$update public.habits set difficulty = 'hard'
                  where id = '0c000000-0000-0000-0000-000000000001'$$,
  'service_role can edit a habit''s difficulty');
reset role;
select is((select count(*)::int from public.daily_schedule
           where user_id = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0'), 8,
  'a service_role insert backfills the schedule');
select ok(pg_temp.has('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', pg_temp.today(),
                      '0c000000-0000-0000-0000-000000000002'),
  'and the new habit joins today''s snapshot');
select is((select difficulty::text from public.daily_schedule_habits
           where user_id = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0' and local_date = pg_temp.today()
             and habit_id = '0c000000-0000-0000-0000-000000000001'), 'medium',
  'a service_role difficulty edit applies from tomorrow too');

-- Deferred FKs hold at the end.
-- ── Round 1 review fixes ─────────────────────────────────────────────────────
-- Rest-day bridge (the #28 hole): Zoe counted 2 days ago, yesterday and today
-- are rest days (no habits), then she jumps east. The new today inherits.
insert into auth.users (id, email) values ('d1d1d1d1-0000-0000-0000-000000000001', 'zoe@example.com');
update public.profiles set onboarded_at = now() - interval '10 days', timezone = 'Etc/GMT+12',
                           last_streak_date = public.local_date_in('Etc/GMT+12', now()) - 2
  where id = 'd1d1d1d1-0000-0000-0000-000000000001';
select pg_temp.as_user('d1d1d1d1-0000-0000-0000-000000000001');
update public.profiles set timezone = 'Pacific/Kiritimati'
  where id = 'd1d1d1d1-0000-0000-0000-000000000001';
select pg_temp.as_postgres();
select is((select last_streak_date from public.profiles where id = 'd1d1d1d1-0000-0000-0000-000000000001'),
  public.local_date_in('Pacific/Kiritimati', now()),
  'moving east across rest days inherits the new today (no extra streak day)');

-- A streak already broken (older than the lookback) isn't revived.
insert into auth.users (id, email) values ('d2d2d2d2-0000-0000-0000-000000000002', 'yan@example.com');
update public.profiles set onboarded_at = now() - interval '30 days', timezone = 'Etc/GMT+12',
                           last_streak_date = public.local_date_in('Etc/GMT+12', now()) - 20
  where id = 'd2d2d2d2-0000-0000-0000-000000000002';
select pg_temp.as_user('d2d2d2d2-0000-0000-0000-000000000002');
update public.profiles set timezone = 'Pacific/Kiritimati'
  where id = 'd2d2d2d2-0000-0000-0000-000000000002';
select pg_temp.as_postgres();
select is((select last_streak_date from public.profiles where id = 'd2d2d2d2-0000-0000-0000-000000000002'),
  public.local_date_in('Etc/GMT+12', now()) - 20,
  'a streak older than the lookback isn''t revived by a jump east');

-- Per-habit streaks follow the eastward rule.
insert into auth.users (id, email) values ('d3d3d3d3-0000-0000-0000-000000000003', 'xia@example.com');
insert into public.habits (id, user_id, title, category, created_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'd3d3d3d3-0000-0000-0000-000000000003', 'Run', 'fitness',
   now() - interval '5 days');
update public.profiles set onboarded_at = now() - interval '5 days', timezone = 'Etc/GMT+12',
                           last_streak_date = public.local_date_in('Etc/GMT+12', now())
  where id = 'd3d3d3d3-0000-0000-0000-000000000003';
insert into public.habit_streaks (habit_id, user_id, current, longest, last_date) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'd3d3d3d3-0000-0000-0000-000000000003', 3, 3,
   public.local_date_in('Etc/GMT+12', now()));
select pg_temp.as_user('d3d3d3d3-0000-0000-0000-000000000003');
update public.profiles set timezone = 'Pacific/Kiritimati'
  where id = 'd3d3d3d3-0000-0000-0000-000000000003';
select pg_temp.as_postgres();
select is((select last_date from public.habit_streaks where habit_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  public.local_date_in('Pacific/Kiritimati', now()), 'a habit''s counted day moves east too');

-- Username and timezone in one statement after onboarding is refused (D5).
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select throws_ok($$update public.profiles set username = 'fay_new', timezone = 'Asia/Tokyo'
                   where id = '66666666-6666-6666-6666-666666666666'$$,
  '22023', 'Change your username and timezone separately',
  'a username and timezone change in one statement is refused after onboarding');
select pg_temp.as_postgres();

-- The cooldown hint is in the user's timezone, with a time.
-- Dave is in Asia/Tokyo (UTC+9) from an earlier test.
update public.profiles set timezone_changed_at = now() - interval '1 day'
  where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select throws_like($$update public.profiles set timezone = 'Europe/Berlin'
                     where id = '44444444-4444-4444-4444-444444444444'$$,
  'You can change your timezone once every 7 days', 'the cooldown still applies');
select pg_temp.as_postgres();
create function pg_temp.tz_hint() returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text, true);
  begin
    update public.profiles set timezone = 'Europe/Berlin' where id = '44444444-4444-4444-4444-444444444444';
  exception when sqlstate 'QX001' then
    get stacked diagnostics v = pg_exception_hint;
  end;
  perform set_config('role', 'postgres', true);
  return v;
end $f$;
select is(pg_temp.tz_hint(),
  'Try again on or after '
    || to_char((now() + interval '6 days') at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') || '.',
  'the hint shows the local time (Tokyo, UTC+9) when the change is allowed');

-- Santiago changes DST at local midnight: the integer day loop doesn't skip.
insert into auth.users (id, email) values ('d4d4d4d4-0000-0000-0000-000000000004', 'sam@example.com');
update public.profiles set onboarded_at = '2026-09-01 12:00:00+00', timezone = 'America/Santiago'
  where id = 'd4d4d4d4-0000-0000-0000-000000000004';
set local timezone = 'America/Santiago';
select is(public.ensure_daily_schedule('d4d4d4d4-0000-0000-0000-000000000004', '2026-09-08 15:00:00+00'),
  '2026-09-08'::date, 'Santiago: today is 2026-09-08');
select is((select array_agg(local_date order by local_date)::text from public.daily_schedule
           where user_id = 'd4d4d4d4-0000-0000-0000-000000000004'),
  '{2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05,2026-09-06,2026-09-07,2026-09-08}',
  'every day is snapshotted across a midnight DST change, today included');
set local timezone = 'UTC';

select lives_ok($$set constraints all immediate$$, 'every snapshot row has its day');

select * from finish();
rollback;
