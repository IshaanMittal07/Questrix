-- Questrix is passwordless (email code, magic link, Google). GoTrue still accepts
-- password sign-ups and updateUser({ password }), which allows:
--   * account pre-hijack: an attacker registers victim@x with a password, the
--     victim later confirms the row by signing in with a code, and the
--     attacker's password keeps working;
--   * persistence: a stolen session plants a password that outlives sign-out.
-- So no password hash is ever stored. An empty hash never matches, so password
-- sign-in always fails with invalid credentials. NULL (some OAuth/admin paths)
-- is left as NULL. Invoker rights: the function only rewrites NEW.
-- NOTE: this makes signUp/updateUser/admin createUser with a password "succeed"
-- without storing it. A future password feature must drop this trigger.
create function public.strip_auth_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.encrypted_password is not null and new.encrypted_password <> '' then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;

revoke execute on function public.strip_auth_password() from public, anon, authenticated;

create trigger strip_auth_password
  before insert or update of encrypted_password on auth.users
  for each row execute function public.strip_auth_password();

-- Existing rows (local/dev only at this point).
update auth.users set encrypted_password = '' where encrypted_password <> '';
