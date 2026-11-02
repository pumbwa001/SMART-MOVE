create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.smart_move_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.smart_move_payment_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  redeemed_by uuid unique references auth.users (id),
  redeemed_at timestamptz
);

create table if not exists public.smart_move_redemption_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create table if not exists public.smart_move_questions (
  subject text not null check (subject in ('biology', 'chemistry', 'physics')),
  question_number integer not null check (question_number > 0),
  question_text text not null,
  options jsonb not null check (
    case
      when pg_catalog.jsonb_typeof(options) = 'array'
        then pg_catalog.jsonb_array_length(options) = 4
      else false
    end
  ),
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null,
  primary key (subject, question_number)
);

create table if not exists public.smart_move_private_settings (
  singleton boolean primary key default true check (singleton),
  transaction_hmac_key bytea not null default extensions.gen_random_bytes(32)
);

insert into public.smart_move_private_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create index if not exists smart_move_redemption_attempts_user_time_idx
  on public.smart_move_redemption_attempts (user_id, attempted_at desc);

alter table public.smart_move_admins enable row level security;
alter table public.smart_move_payment_codes enable row level security;
alter table public.smart_move_redemption_attempts enable row level security;
alter table public.smart_move_questions enable row level security;
alter table public.smart_move_private_settings enable row level security;

revoke all on public.smart_move_admins from anon, authenticated;
revoke all on public.smart_move_payment_codes from anon, authenticated;
revoke all on public.smart_move_redemption_attempts from anon, authenticated;
revoke all on public.smart_move_questions from anon, authenticated;
revoke all on public.smart_move_private_settings from anon, authenticated;
revoke all on sequence public.smart_move_redemption_attempts_id_seq from anon, authenticated;

create or replace function public.smart_move_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.smart_move_admins as admins
    where admins.user_id = (select auth.uid())
  );
$function$;

create or replace function public.smart_move_has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    public.smart_move_is_admin()
    or exists (
      select 1
      from public.smart_move_payment_codes as payments
      where payments.redeemed_by = (select auth.uid())
    );
$function$;

create or replace function public.smart_move_add_payment_code(p_transaction_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_code text;
  transaction_hmac_key bytea;
begin
  if not public.smart_move_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;

  normalized_code := pg_catalog.btrim(p_transaction_id);
  if normalized_code is null or pg_catalog.length(normalized_code) < 4
     or pg_catalog.length(normalized_code) > 128 then
    raise exception using errcode = '22023', message = 'Enter a transaction ID between 4 and 128 characters.';
  end if;

  select settings.transaction_hmac_key
  into transaction_hmac_key
  from public.smart_move_private_settings as settings
  where settings.singleton = true;

  if transaction_hmac_key is null then
    raise exception using errcode = 'P0001', message = 'Payment ID security settings are unavailable.';
  end if;

  insert into public.smart_move_payment_codes (code_hash, created_by)
  values (
    pg_catalog.encode(
      extensions.hmac(
        pg_catalog.convert_to(normalized_code, 'UTF8'),
        transaction_hmac_key,
        'sha256'
      ),
      'hex'
    ),
    (select auth.uid())
  )
  on conflict (code_hash) do nothing;

  return found;
end;
$function$;

create or replace function public.smart_move_redeem_payment(p_transaction_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid;
  normalized_code text;
  transaction_hmac_key bytea;
  transaction_code_id uuid;
  transaction_redeemed_by uuid;
begin
  current_user_id := (select auth.uid());
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in before redeeming a transaction ID.';
  end if;

  normalized_code := pg_catalog.btrim(p_transaction_id);
  if normalized_code is null or pg_catalog.length(normalized_code) < 4
     or pg_catalog.length(normalized_code) > 128 then
    raise exception using errcode = '22023', message = 'Enter a valid transaction ID.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  if public.smart_move_has_access() then
    return true;
  end if;

  select settings.transaction_hmac_key
  into transaction_hmac_key
  from public.smart_move_private_settings as settings
  where settings.singleton = true;

  if transaction_hmac_key is null then
    raise exception using errcode = 'P0001', message = 'Payment ID security settings are unavailable.';
  end if;

  delete from public.smart_move_redemption_attempts
  where attempted_at < pg_catalog.now() - interval '1 day';

  if (
    select pg_catalog.count(*)
    from public.smart_move_redemption_attempts as attempts
    where attempts.user_id = current_user_id
      and attempts.attempted_at > pg_catalog.now() - interval '15 minutes'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'Too many attempts. Try again in 15 minutes.';
  end if;

  insert into public.smart_move_redemption_attempts (user_id)
  values (current_user_id);

  select payments.id, payments.redeemed_by
  into transaction_code_id, transaction_redeemed_by
  from public.smart_move_payment_codes as payments
  where payments.code_hash =
    pg_catalog.encode(
      extensions.hmac(
        pg_catalog.convert_to(normalized_code, 'UTF8'),
        transaction_hmac_key,
        'sha256'
      ),
      'hex'
    )
  for update;

  if not found or transaction_redeemed_by is not null then
    return false;
  end if;

  update public.smart_move_payment_codes
  set redeemed_by = current_user_id,
      redeemed_at = pg_catalog.now()
  where id = transaction_code_id
    and redeemed_by is null;

  return found;
end;
$function$;

create or replace function public.smart_move_list_payment_codes()
returns table (created_at timestamptz, redeemed boolean)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.smart_move_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;

  return query
  select payments.created_at, payments.redeemed_by is not null
  from public.smart_move_payment_codes as payments
  order by payments.created_at desc
  limit 200;
end;
$function$;

create or replace function public.smart_move_get_questions(p_subject text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not public.smart_move_has_access() then
    raise exception using errcode = '42501', message = 'Paid Smart Move access is required.';
  end if;

  if p_subject is null or p_subject not in ('biology', 'chemistry', 'physics', 'mixed') then
    raise exception using errcode = '22023', message = 'Choose a valid quiz subject.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'q', questions.question_text,
        'options', questions.options,
        'answer', questions.correct_index,
        'explanation', questions.explanation,
        'subject', questions.subject
      )
      order by questions.subject, questions.question_number
    ),
    '[]'::jsonb
  )
  into result
  from public.smart_move_questions as questions
  where p_subject = 'mixed' or questions.subject = p_subject;

  return result;
end;
$function$;

revoke all on function public.smart_move_is_admin() from public, anon;
revoke all on function public.smart_move_has_access() from public, anon;
revoke all on function public.smart_move_add_payment_code(text) from public, anon;
revoke all on function public.smart_move_redeem_payment(text) from public, anon;
revoke all on function public.smart_move_list_payment_codes() from public, anon;
revoke all on function public.smart_move_get_questions(text) from public, anon;

grant execute on function public.smart_move_is_admin() to authenticated;
grant execute on function public.smart_move_has_access() to authenticated;
grant execute on function public.smart_move_add_payment_code(text) to authenticated;
grant execute on function public.smart_move_redeem_payment(text) to authenticated;
grant execute on function public.smart_move_list_payment_codes() to authenticated;
grant execute on function public.smart_move_get_questions(text) to authenticated;
