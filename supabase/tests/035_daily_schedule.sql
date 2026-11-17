-- Phase 4 (#67): daily schedule snapshots and the timezone-change limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

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
  'moving east without a counted day today changes nothing');

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

-- Deferred FKs hold at the end.
select lives_ok($$set constraints all immediate$$, 'every snapshot row has its day');

select * from finish();
rollback;
