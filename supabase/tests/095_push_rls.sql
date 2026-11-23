-- Phase 5 (#87): push_subscriptions, reminder_log, notification settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.ep(n int) returns text language sql as $$
  select 'https://fcm.googleapis.com/fcm/send/device-' || n $$;
-- Valid-looking keys (base64url).
create function pg_temp.save(p_endpoint text) returns uuid language sql as $$
  select public.save_push_subscription(p_endpoint,
    'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ', 'k3yAuthSecret01', 'Mozilla/5.0 (iPhone)') $$;

-- Alice, Bob, Carol.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Meditate', 'mind');

-- ── Structure and privileges ────────────────────────────────────────────────
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select has_table('public', 'reminder_log', 'reminder_log exists');
select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'push_subscriptions has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.reminder_log'::regclass), 'reminder_log has RLS');
select table_privs_are('public', 'push_subscriptions', 'authenticated', array['SELECT', 'DELETE'],
  'clients can only read and delete subscriptions (writes go through the RPC)');
select table_privs_are('public', 'push_subscriptions', 'anon', array[]::text[], 'anon has no access to subscriptions');
select table_privs_are('public', 'reminder_log', 'authenticated', array[]::text[], 'clients have no access to reminder_log');
select table_privs_are('public', 'reminder_log', 'anon', array[]::text[], 'nor does anon');
select col_is_pk('public', 'reminder_log', array['habit_id', 'local_date', 'reminder_time'],
  'reminder_log is keyed by (habit, local date, reminder time): at most once');
select col_is_unique('public', 'push_subscriptions', 'endpoint', 'an endpoint is saved once');
select function_privs_are('public', 'save_push_subscription', array['text', 'text', 'text', 'text'],
  'authenticated', array['EXECUTE'], 'signed-in users can save a subscription');
select function_privs_are('public', 'save_push_subscription', array['text', 'text', 'text', 'text'],
  'anon', array[]::text[], 'anon cannot');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'public.save_push_subscription(text, text, text, text)'::regprocedure), true,
  'save_push_subscription is SECURITY DEFINER with an empty search_path');
select column_privs_are('public', 'profiles', 'push_enabled', 'authenticated', array['SELECT', 'UPDATE'],
  'clients can change push_enabled');
select column_privs_are('public', 'profiles', 'streak_saver_enabled', 'authenticated', array['SELECT', 'UPDATE'],
  'and streak_saver_enabled');
select ok((select push_enabled and streak_saver_enabled from public.profiles
           where id = '11111111-1111-1111-1111-111111111111'), 'both default to on');
select has_index('public', 'habits', 'habits_reminders_idx', 'the partial reminders index exists');

-- ── Saving ──────────────────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$select pg_temp.save(pg_temp.ep(1))$$, '42501', null, 'anon can''t save');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$select pg_temp.save(pg_temp.ep(1))$$, 'Alice saves a subscription');
select lives_ok($$select pg_temp.save(pg_temp.ep(1))$$, 'saving the same endpoint again is an update');
select is((select count(*)::int from public.push_subscriptions), 1, 'she sees one row');
select throws_ok($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
                   values ('11111111-1111-1111-1111-111111111111', 'https://fcm.googleapis.com/x', 'BOr8z6W6Lm5vB9sF0QkPzXxk', 'k3yAuthSecret01')$$,
  '42501', null, 'a direct insert is refused');
select throws_ok($$update public.push_subscriptions set user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'a direct update is refused');

-- Endpoints the server would POST to must be https on a known push service.
select throws_ok($$select pg_temp.save('http://fcm.googleapis.com/fcm/send/x')$$, '23514', null, 'http is refused');
select throws_ok($$select pg_temp.save('https://169.254.169.254/latest/meta-data')$$, '23514', null,
  'an arbitrary host is refused (SSRF)');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com.evil.example/x')$$, '23514', null,
  'a lookalike host is refused');
select lives_ok($$select pg_temp.save('https://web.push.apple.com/QGx-device'); select pg_temp.save('https://updates.push.services.mozilla.com/wpush/v2/abc');
                  select pg_temp.save('https://wns2-par02p.notify.windows.com/w/?token=abc')$$,
  'Apple, Mozilla and Windows push services are accepted');
select throws_ok($$select public.save_push_subscription(pg_temp.ep(9), 'not base64!', 'k3yAuthSecret01')$$,
  '23514', null, 'malformed keys are refused');

-- ── Visibility and takeover ─────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.push_subscriptions), 0, 'Bob sees none of Alice''s subscriptions');
delete from public.push_subscriptions where endpoint = pg_temp.ep(1);
select pg_temp.as_postgres();
select is((select count(*)::int from public.push_subscriptions where endpoint = pg_temp.ep(1)), 1,
  'and can''t delete them');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.save(pg_temp.ep(1));
select pg_temp.as_postgres();
select is((select user_id from public.push_subscriptions where endpoint = pg_temp.ep(1)),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Bob signing in on Alice''s device moves its subscription to him');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
delete from public.push_subscriptions where endpoint = pg_temp.ep(1);
select pg_temp.as_postgres();
select is((select count(*)::int from public.push_subscriptions where endpoint = pg_temp.ep(1)), 0,
  'he can delete his own');

-- ── The per-user cap ────────────────────────────────────────────────────────
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.save(pg_temp.ep(100 + g)) from generate_series(1, 10) as g;
select throws_ok($$select pg_temp.save(pg_temp.ep(200))$$, 'QX001', null, 'an 11th device is refused');
select lives_ok($$select pg_temp.save(pg_temp.ep(101))$$, 'but re-saving an existing one is fine');

-- ── reminder_log and cascades ───────────────────────────────────────────────
select pg_temp.as_postgres();
insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-23', '08:00', '11111111-1111-1111-1111-111111111111');
select throws_ok($$insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-23', '08:00', '11111111-1111-1111-1111-111111111111')$$,
  '23505', null, 'a reminder is logged once');
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select ok(not exists (select 1 from public.push_subscriptions where user_id = '11111111-1111-1111-1111-111111111111')
          and not exists (select 1 from public.reminder_log where user_id = '11111111-1111-1111-1111-111111111111'),
  'deleting an account removes its subscriptions and reminder log');

select * from finish();
rollback;
