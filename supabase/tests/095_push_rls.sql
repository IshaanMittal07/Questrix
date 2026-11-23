-- Phase 5 (#87): push_subscriptions, reminder_log, notification settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

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
    'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY', 'Mozilla/5.0 (iPhone)') $$;

-- Alice, Bob, Carol.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');
insert into public.habits (id, user_id, title, category) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Meditate', 'mind'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Read', 'mind');

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
select is((select pg_get_expr(indpred, indrelid) from pg_index
           where indexrelid = 'public.habits_reminders_idx'::regclass),
  '((archived_at IS NULL) AND reminders_enabled AND (cardinality(reminder_times) > 0))',
  'it covers only live habits with reminders on and at least one time');
select ok(not exists (select 1 from pg_proc, aclexplode(proacl) a
                      where oid = 'public.save_push_subscription(text, text, text, text)'::regprocedure
                        and a.grantee = 0),
  'PUBLIC has no EXECUTE on save_push_subscription');
select function_privs_are('public', 'save_push_subscription', array['text', 'text', 'text', 'text'],
  'service_role', array['EXECUTE'], 'service_role keeps EXECUTE (it has no auth.uid(), see below)');

-- ── Settings columns ────────────────────────────────────────────────────────
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select throws_ok($$update public.profiles set push_enabled = false, points_balance = 999999
                   where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'the new column grant doesn''t let clients write points alongside it');
select throws_ok($$update public.profiles set lifetime_points = 999999
                   where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'nor lifetime points');
update public.profiles set push_enabled = false where id = '11111111-1111-1111-1111-111111111111';
select is((select push_enabled from public.profiles where id = '11111111-1111-1111-1111-111111111111'), false,
  'Alice can turn push off for herself');
update public.profiles set streak_saver_enabled = false where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_postgres();
select ok((select streak_saver_enabled from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'but not the streak saver for Bob (RLS)');
select is((select points_balance from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 0,
  'and her balance is untouched');

-- ── Callers without a user ──────────────────────────────────────────────────
set local role service_role;
select throws_ok($$select pg_temp.save(pg_temp.ep(1))$$, '28000', null,
  'service_role has no auth.uid(), so the RPC refuses it');
select pg_temp.as_postgres();
select pg_temp.as_user(null);
select throws_ok($$select pg_temp.save(pg_temp.ep(1))$$, '28000', null,
  'an authenticated role with no sub claim is refused');
select pg_temp.as_postgres();
select is((select count(*)::int from public.push_subscriptions), 0, 'neither saved anything');

-- ── Saving ──────────────────────────────────────────────────────────────────
select pg_temp.as_anon();
select throws_ok($$select pg_temp.save(pg_temp.ep(1))$$, '42501', null, 'anon can''t save');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok($$select pg_temp.save(pg_temp.ep(1))$$, 'Alice saves a subscription');
select lives_ok($$select pg_temp.save(pg_temp.ep(1))$$, 'saving the same endpoint again is an update');
select is((select count(*)::int from public.push_subscriptions), 1, 'she sees one row');
select throws_ok($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
                   values ('11111111-1111-1111-1111-111111111111', 'https://fcm.googleapis.com/x', 'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY')$$,
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
select throws_ok($$select pg_temp.save('https://evil@fcm.googleapis.com/x')$$, '23514', null,
  'userinfo before the host is refused');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com@evil.example/x')$$, '23514', null,
  'a known host as userinfo is refused');
select throws_ok($$select pg_temp.save('HTTPS://fcm.googleapis.com/x')$$, '23514', null,
  'the scheme check is case-sensitive');
select throws_ok($$select pg_temp.save('https://FCM.googleapis.com/x')$$, '23514', null,
  'so is the host');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com:8443/x')$$, '23514', null,
  'an explicit port is refused');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com./x')$$, '23514', null,
  'a trailing-dot host is refused');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com')$$, '23514', null,
  'a path-less endpoint is refused');
select throws_ok($$select pg_temp.save(' https://fcm.googleapis.com/x')$$, '23514', null,
  'leading whitespace is refused');
select throws_ok($$select pg_temp.save('https://evil.example/.push.apple.com/x')$$, '23514', null,
  'a push host in the path is refused');
select throws_ok($$select pg_temp.save('https://evilpush.apple.com/x')$$, '23514', null,
  'a suffix without the label dot is refused');
select throws_ok($$select pg_temp.save('https://a.b.push.apple.com/x')$$, '23514', null,
  'only one label under push.apple.com');
select throws_ok($$select pg_temp.save('https://web.push.apple.com.evil.example/x')$$, '23514', null,
  'an Apple lookalike is refused');
select throws_ok($$select pg_temp.save('https://' || chr(1072) || '.push.apple.com/x')$$, '23514', null,
  'a Cyrillic homoglyph label is refused');
select throws_ok($$select pg_temp.save('https://fcmXgoogleapis.com/x')$$, '23514', null,
  'dots are literal');
select lives_ok($$select pg_temp.save('https://fcm.googleapis.com/' || repeat('a', 1024 - 27))$$,
  'a 1024-character endpoint is accepted');
select throws_ok($$select pg_temp.save('https://fcm.googleapis.com/' || repeat('a', 1025 - 27))$$, '23514', null,
  'a 1025-character endpoint is refused');
select throws_ok($$select public.save_push_subscription(pg_temp.ep(9), 'BOr8z6W6Lm5vB9sF0QkPzXxk+/', 'k3yAuthSecret01_abc-XY')$$,
  '23514', null, 'standard base64 (+/) keys are refused');
select throws_ok($$select public.save_push_subscription(pg_temp.ep(9), 'BOr8z6W6Lm5vB9sF0Qk', 'k3yAuthSecret01_abc-XY')$$,
  '23514', null, 'a p256dh that isn''t 87 characters is refused');

-- user_agent is truncated to 512 and empty becomes null.
select public.save_push_subscription(pg_temp.ep(300), 'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY', repeat('U', 600));
select is((select length(user_agent) from public.push_subscriptions where endpoint = pg_temp.ep(300)), 512,
  'a long user agent is truncated to 512');
select public.save_push_subscription(pg_temp.ep(301), 'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY', '');
select ok((select user_agent is null from public.push_subscriptions where endpoint = pg_temp.ep(301)),
  'an empty user agent is stored as null');

-- Re-saving her own endpoint replaces the keys but keeps its history.
select pg_temp.as_postgres();
update public.push_subscriptions
   set last_success_at = '2026-11-20 08:00+00', created_at = '2026-11-01 00:00+00'
 where endpoint = pg_temp.ep(1);
select set_config('qx.alice_ep1',
  (select id::text from public.push_subscriptions where endpoint = pg_temp.ep(1)), true);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(public.save_push_subscription(pg_temp.ep(1), 'NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEW', 'newAuthSecret01newAuth'),
  current_setting('qx.alice_ep1')::uuid, 'a same-owner re-save returns the same row');
select is((select row(p256dh, auth, last_success_at, created_at)::text from public.push_subscriptions
           where endpoint = pg_temp.ep(1)),
  row('NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEW', 'newAuthSecret01newAuth', '2026-11-20 08:00+00'::timestamptz,
      '2026-11-01 00:00+00'::timestamptz)::text,
  'it replaces the keys and keeps last_success_at and created_at');
select throws_ok($$select public.save_push_subscription(pg_temp.ep(9), 'not base64!', 'k3yAuthSecret01_abc-XY')$$,
  '23514', null, 'malformed keys are refused');

-- ── Visibility and takeover ─────────────────────────────────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.push_subscriptions), 0, 'Bob sees none of Alice''s subscriptions');
delete from public.push_subscriptions where endpoint = pg_temp.ep(1);
select pg_temp.as_postgres();
select is((select count(*)::int from public.push_subscriptions where endpoint = pg_temp.ep(1)), 1,
  'and can''t delete them');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select set_config('qx.bob_ep1', pg_temp.save(pg_temp.ep(1))::text, true);
select pg_temp.as_postgres();
select is((select user_id from public.push_subscriptions where endpoint = pg_temp.ep(1)),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Bob signing in on Alice''s device moves its subscription to him');
select is((select row(id <> current_setting('qx.alice_ep1')::uuid, last_success_at is null, created_at = now(), p256dh)::text
           from public.push_subscriptions where endpoint = pg_temp.ep(1)),
  row(true, true, true,
      'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh')::text,
  'the row moves with his keys under a new id (so a stale id can''t credit him), and last_success_at and created_at reset');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.push_subscriptions where id = current_setting('qx.bob_ep1')::uuid), 1,
  'the id the RPC returns is a row Bob can now see');
select is((select count(*)::int from public.push_subscriptions), 1,
  'and the takeover shows him none of Alice''s other rows');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.push_subscriptions where endpoint = pg_temp.ep(1)), 0,
  'Alice no longer sees the moved row');
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
select throws_ok($$select pg_temp.save('https://web.push.apple.com/QGx-device')$$, 'QX001', null,
  'taking over another user''s endpoint counts toward the cap');
select pg_temp.as_postgres();
select is((select user_id from public.push_subscriptions where endpoint = 'https://web.push.apple.com/QGx-device'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'so the endpoint stays with Alice');
select is((select count(*)::int from public.push_subscriptions
           where user_id = '33333333-3333-3333-3333-333333333333'), 10,
  'and Carol still has exactly 10');

-- ── reminder_log and cascades ───────────────────────────────────────────────
select pg_temp.as_postgres();
insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-23', '08:00', '11111111-1111-1111-1111-111111111111');
select throws_ok($$insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-23', '08:00', '11111111-1111-1111-1111-111111111111')$$,
  '23505', null, 'a reminder is logged once');
insert into public.reminder_log (habit_id, local_date, reminder_time, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000002', '2026-11-23', '08:00', '11111111-1111-1111-1111-111111111111');
delete from public.habits where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is((select count(*)::int from public.reminder_log), 1,
  'deleting a habit removes only its reminder log');
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select ok(not exists (select 1 from public.push_subscriptions where user_id = '11111111-1111-1111-1111-111111111111')
          and not exists (select 1 from public.reminder_log where user_id = '11111111-1111-1111-1111-111111111111'),
  'deleting an account removes its subscriptions and reminder log');

-- ── Tightened endpoint rules (review of the #87 tests) ──────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select throws_ok($$select pg_temp.save('https://-.push.apple.com/x')$$, '23514', null,
  'a host label can''t start with a hyphen');
select throws_ok($$select pg_temp.save('https://web.push.apple.com/x' || chr(10) || 'y')$$, '23514', null,
  'control characters are refused anywhere in the endpoint');
select throws_ok($$select pg_temp.save('https://web.push.apple.com/a b')$$, '23514', null,
  'and so are spaces');
select pg_temp.as_postgres();

-- ── Key sizes are pinned (security audit of PR #95, B1) ─────────────────────
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select throws_ok($$select public.save_push_subscription('https://fcm.googleapis.com/pad',
                     repeat('A', 87) || repeat('=', 5000), 'k3yAuthSecret01_abc-XY')$$,
  '23514', null, 'p256dh padding can''t grow the row');
select throws_ok($$select public.save_push_subscription('https://fcm.googleapis.com/pad',
                     'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', repeat('a', 22) || repeat('=', 5000))$$,
  '23514', null, 'nor can auth padding');
select lives_ok($$select public.save_push_subscription('https://fcm.googleapis.com/padded',
                    'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh=', 'k3yAuthSecret01_abc-XY==')$$,
  'standard padding (one = and two =) is accepted');
select throws_ok($$select pg_temp.save('https://web.push.apple.com/' || chr(8203) || 'x')$$, '23514', null,
  'non-ASCII (a zero-width space) is refused, so the unique index never sees an oversized key');
select throws_ok($$select pg_temp.save('https://web.push.apple.com/' || repeat(chr(128512), 990))$$, '23514', null,
  'and long non-ASCII paths fail the CHECK, not the btree');
select is((select user_agent from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/padded'), null,
  '(a missing user agent stays null)');
select public.save_push_subscription('https://fcm.googleapis.com/ua', 'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY', 'Safari' || chr(7) || chr(10) || '/17');
select is((select user_agent from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/ua'), 'Safari/17',
  'control characters are stripped from the user agent');
select public.save_push_subscription('https://fcm.googleapis.com/ua', 'BOr8z6W6Lm5vB9sF0QkPzXxkTqD8Lh9n3a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXyZ0123456789abcdefgh', 'k3yAuthSecret01_abc-XY');
select is((select user_agent from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/ua'), 'Safari/17',
  'a same-owner re-save without a user agent keeps the stored one');
select pg_temp.as_postgres();
select table_privs_are('public', 'push_subscriptions', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has no TRUNCATE, TRIGGER or REFERENCES on push_subscriptions');
select table_privs_are('public', 'reminder_log', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'nor on reminder_log');

select * from finish();
rollback;
