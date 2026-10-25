-- =============================================================================
-- Smart Base Binary — single canonical host schema (sole migration file)
-- =============================================================================
-- Apply this file alone for a full public schema: tables, indexes, RLS, RPCs,
-- seeds, and cron jobs. Incremental patches are folded below under `-- from:`.
--
-- Tables (30):
--   accounts
--   app_admins
--   audit_log
--   bot_runs
--   bots
--   deposits
--   feature_flags
--   kyc_reviews
--   markets
--   megapay_webhook_events
--   notifications
--   payment_settings
--   payout_fee_stk_requests
--   profiles
--   service_charges
--   simulated_balances
--   simulated_win_rate_overrides
--   simulation_settings
--   simulation_signals
--   support_messages
--   support_tickets
--   system_issues
--   trade_settlements
--   trades
--   trading_settings
--   transactions
--   users
--   wallet_ledger
--   wallets
--   withdrawals
--
-- Current through: 20261014120000_superadmin_panel.sql
-- =============================================================================

-- from: 20261006120000_base_tables.sql
create extension if not exists pgcrypto;
create table if not exists public.accounts (
  account_mode text not null,
  created_at timestamptz not null default now(),
  id uuid not null default gen_random_uuid(),
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.audit_log (
  account_id uuid,
  account_mode text,
  action text not null,
  actor_email text,
  actor_id uuid,
  after_state jsonb default '{}'::jsonb,
  before_state jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  id bigint generated always as identity,
  ip text,
  target_id uuid,
  target_type text,
  updated_at timestamptz not null default now(),
  user_id uuid,
  primary key (id)
);
create table if not exists public.bot_runs (
  account_id uuid not null,
  account_mode text not null,
  bot_id uuid not null,
  created_at timestamptz not null default now(),
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  loss_streak_limit numeric not null,
  max_runs numeric not null,
  note text not null default '',
  realized_pnl numeric,
  stake numeric not null,
  started_at timestamptz,
  status text not null default 'active',
  stop_loss numeric,
  stopped_at timestamptz,
  take_profit numeric,
  trades_placed numeric not null default 0,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.bots (
  created_at timestamptz not null default now(),
  default_stake numeric not null,
  description text not null default '',
  historical_performance text not null default '',
  id uuid not null default gen_random_uuid(),
  is_active boolean not null default false,
  loss_streak_limit numeric not null,
  market_symbol text not null,
  max_runs numeric not null,
  name text not null,
  risk_level text not null default '',
  stop_loss numeric,
  take_profit numeric,
  updated_at timestamptz not null default now(),
  primary key (id)
);
create table if not exists public.deposits (
  account_id uuid not null,
  account_mode text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  currency text not null default 'USD',
  details jsonb not null default '{}'::jsonb,
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  method text not null default '',
  provider text,
  provider_reference text,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  wallet_id uuid not null,
  primary key (id)
);
create table if not exists public.feature_flags (
  key text not null,
  label text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by text,
  value boolean not null default false,
  primary key (key)
);
create table if not exists public.kyc_reviews (
  created_at timestamptz not null default now(),
  document_paths text[] not null default '{}',
  id uuid not null default gen_random_uuid(),
  notes text,
  reviewed_at timestamptz,
  reviewer_id uuid,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.markets (
  category text not null,
  contract_kinds text[] not null default '{}',
  created_at timestamptz not null default now(),
  display_name text not null,
  durations_ms integer[] not null default '{}',
  feed_label text not null default '',
  is_active boolean not null default false,
  is_simulated boolean not null default false,
  last_price numeric,
  price_status text not null default 'disconnected',
  symbol text not null,
  updated_at timestamptz not null default now(),
  primary key (symbol)
);
create table if not exists public.notifications (
  account_id uuid,
  account_mode text,
  body text not null,
  created_at timestamptz not null default now(),
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  kind text not null,
  read boolean not null default false,
  title text not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.profiles (
  created_at timestamptz not null default now(),
  display_name text,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (user_id)
);
create table if not exists public.support_messages (
  created_at timestamptz not null default now(),
  id uuid not null default gen_random_uuid(),
  message text not null,
  read_at timestamptz,
  sender_role text not null default '',
  sender_user_id uuid not null,
  ticket_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (id)
);
create table if not exists public.support_tickets (
  account_id uuid,
  account_mode text,
  created_at timestamptz not null default now(),
  id uuid not null default gen_random_uuid(),
  message text not null,
  status text not null default 'active',
  subject text not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.trade_settlements (
  account_id uuid not null,
  account_mode text not null,
  created_at timestamptz not null default now(),
  exit_price numeric,
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  outcome text not null,
  payout numeric,
  profit_loss numeric,
  settlement_digit numeric,
  trade_id uuid not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.trades (
  account_id uuid not null,
  account_mode text not null,
  barrier numeric,
  contract_option text not null,
  contract_type text not null,
  created_at timestamptz not null default now(),
  duration_ms numeric not null,
  entry_price numeric,
  exit_price numeric,
  expires_at timestamptz,
  id uuid not null default gen_random_uuid(),
  idempotency_key text,
  is_simulated boolean not null default false,
  payout numeric,
  payout_rate numeric,
  profit_loss numeric,
  resolved_at timestamptz,
  selected_digit numeric,
  stake numeric not null,
  status text not null default 'active',
  symbol text not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  wallet_id uuid not null,
  primary key (id)
);
create table if not exists public.transactions (
  account_id uuid not null,
  account_mode text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  currency text not null default 'USD',
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  note text,
  reference text,
  status text not null default 'active',
  type text not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  wallet_id uuid not null,
  primary key (id)
);
create table if not exists public.users (
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  email text,
  id uuid not null,
  kyc_status text not null default 'not_started',
  live_trading_enabled boolean not null default true,
  name text,
  role text not null default 'trader',
  suspended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (id)
);
create table if not exists public.wallet_ledger (
  account_id uuid not null,
  account_mode text not null,
  amount numeric not null,
  available_after numeric,
  balance_after numeric default 0,
  created_at timestamptz not null default now(),
  entry_type text not null,
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  locked_after numeric,
  note text,
  reference_id uuid,
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  wallet_id uuid not null,
  primary key (id)
);
create table if not exists public.wallets (
  account_id uuid not null,
  account_mode text not null,
  available_balance numeric not null default 0,
  balance numeric not null default 0,
  created_at timestamptz not null default now(),
  currency text not null default 'USD',
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  locked_balance numeric not null default 0,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  primary key (id)
);
create table if not exists public.withdrawals (
  account_id uuid not null,
  account_mode text not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  currency text not null default 'USD',
  destination text not null,
  destination_details jsonb not null default '{}'::jsonb,
  id uuid not null default gen_random_uuid(),
  is_simulated boolean not null default false,
  provider text,
  provider_reference text,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  admin_note text,
  admin_user_id uuid,
  amount_kes numeric,
  completed_at timestamptz,
  conversation_id text,
  details jsonb not null default '{}'::jsonb,
  failed_at timestamptz,
  failure_reason text,
  fee_kes numeric not null default 0,
  mpesa_receipt text,
  msisdn text,
  net_kes numeric,
  originator_conversation_id text,
  processing_at timestamptz,
  reference text,
  result_code text,
  result_desc text,
  wallet_id uuid not null,
  primary key (id)
);
alter table public.users drop constraint if exists users_id_fkey;
alter table public.users add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;
alter table public.profiles drop constraint if exists profiles_user_id_fkey;
alter table public.profiles add constraint profiles_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.accounts drop constraint if exists accounts_user_id_fkey;
alter table public.accounts add constraint accounts_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
create unique index if not exists accounts_user_mode_uniq on public.accounts (user_id, account_mode);
create unique index if not exists wallets_user_mode_uniq on public.wallets (user_id, account_mode);
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at before update on public.accounts for each row execute function public.set_updated_at();
drop trigger if exists audit_log_set_updated_at on public.audit_log;
create trigger audit_log_set_updated_at before update on public.audit_log for each row execute function public.set_updated_at();
drop trigger if exists bot_runs_set_updated_at on public.bot_runs;
create trigger bot_runs_set_updated_at before update on public.bot_runs for each row execute function public.set_updated_at();
drop trigger if exists bots_set_updated_at on public.bots;
create trigger bots_set_updated_at before update on public.bots for each row execute function public.set_updated_at();
drop trigger if exists deposits_set_updated_at on public.deposits;
create trigger deposits_set_updated_at before update on public.deposits for each row execute function public.set_updated_at();
drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at before update on public.feature_flags for each row execute function public.set_updated_at();
drop trigger if exists kyc_reviews_set_updated_at on public.kyc_reviews;
create trigger kyc_reviews_set_updated_at before update on public.kyc_reviews for each row execute function public.set_updated_at();
drop trigger if exists markets_set_updated_at on public.markets;
create trigger markets_set_updated_at before update on public.markets for each row execute function public.set_updated_at();
drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at before update on public.notifications for each row execute function public.set_updated_at();
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists support_messages_set_updated_at on public.support_messages;
create trigger support_messages_set_updated_at before update on public.support_messages for each row execute function public.set_updated_at();
drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();
drop trigger if exists trade_settlements_set_updated_at on public.trade_settlements;
create trigger trade_settlements_set_updated_at before update on public.trade_settlements for each row execute function public.set_updated_at();
drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at before update on public.trades for each row execute function public.set_updated_at();
drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at before update on public.transactions for each row execute function public.set_updated_at();
drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
drop trigger if exists wallet_ledger_set_updated_at on public.wallet_ledger;
create trigger wallet_ledger_set_updated_at before update on public.wallet_ledger for each row execute function public.set_updated_at();
drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at before update on public.wallets for each row execute function public.set_updated_at();
drop trigger if exists withdrawals_set_updated_at on public.withdrawals;
create trigger withdrawals_set_updated_at before update on public.withdrawals for each row execute function public.set_updated_at();
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  demo_account uuid;
  real_account uuid;
  display text;
begin
  display := coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'trader'), '@', 1));
  insert into public.users (id, email, name, role, account_status, live_trading_enabled, kyc_status)
  values (new.id, new.email, display, 'trader', 'active', true, 'not_started')
  on conflict (id) do nothing;
  insert into public.profiles (user_id, display_name)
  values (new.id, display)
  on conflict (user_id) do nothing;
  insert into public.accounts (user_id, account_mode, status)
  values (new.id, 'demo', 'active')
  returning id into demo_account;
  insert into public.accounts (user_id, account_mode, status)
  values (new.id, 'real', 'active')
  returning id into real_account;
  insert into public.wallets (
    user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
  ) values
    (new.id, demo_account, 'demo', 'USD', 10000, 10000, 0, 'ready', true),
    (new.id, real_account, 'real', 'USD', 0, 0, 0, 'ready', false);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
alter table public.accounts enable row level security;
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated using (user_id = auth.uid());
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated using (user_id = auth.uid());
alter table public.bot_runs enable row level security;
drop policy if exists bot_runs_select on public.bot_runs;
create policy bot_runs_select on public.bot_runs for select to authenticated using (user_id = auth.uid());
alter table public.bots enable row level security;
drop policy if exists bots_select on public.bots;
create policy bots_select on public.bots for select to anon, authenticated using (true);
alter table public.deposits enable row level security;
drop policy if exists deposits_select on public.deposits;
create policy deposits_select on public.deposits for select to authenticated using (user_id = auth.uid());
alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags for select to anon, authenticated using (true);
alter table public.kyc_reviews enable row level security;
drop policy if exists kyc_reviews_select on public.kyc_reviews;
create policy kyc_reviews_select on public.kyc_reviews for select to authenticated using (user_id = auth.uid());
alter table public.markets enable row level security;
drop policy if exists markets_select on public.markets;
create policy markets_select on public.markets for select to anon, authenticated using (true);
alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (user_id = auth.uid());
alter table public.support_messages enable row level security;
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select to authenticated using (sender_user_id = auth.uid());
alter table public.support_tickets enable row level security;
drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated using (user_id = auth.uid());
alter table public.trade_settlements enable row level security;
drop policy if exists trade_settlements_select on public.trade_settlements;
create policy trade_settlements_select on public.trade_settlements for select to authenticated using (user_id = auth.uid());
alter table public.trades enable row level security;
drop policy if exists trades_select on public.trades;
create policy trades_select on public.trades for select to authenticated using (user_id = auth.uid());
alter table public.transactions enable row level security;
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated using (user_id = auth.uid());
alter table public.users enable row level security;
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated using (id = auth.uid());
alter table public.wallet_ledger enable row level security;
drop policy if exists wallet_ledger_select on public.wallet_ledger;
create policy wallet_ledger_select on public.wallet_ledger for select to authenticated using (user_id = auth.uid());
alter table public.wallets enable row level security;
drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets for select to authenticated using (user_id = auth.uid());
alter table public.withdrawals enable row level security;
drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated using (user_id = auth.uid());
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated, service_role;
grant insert, update, delete on all tables in schema public to service_role;
insert into public.feature_flags (key, value, label, note) values
  ('REAL_TRADING_ENABLED', false, 'Real trading', 'Disabled until settlement is configured.'),
  ('REAL_PAYMENTS_ENABLED', false, 'Real payments', 'Disabled until a payment provider is configured.'),
  ('REAL_WITHDRAWALS_ENABLED', false, 'Real withdrawals', 'Disabled until withdrawals are configured.')
on conflict (key) do nothing;
-- from: 20260920111952_align_markets_catalog_with_app.sql
ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_category_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_category_check
  CHECK (category = ANY (ARRAY['synthetic'::text, 'forex'::text, 'crypto'::text]));
ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_price_status_check;
ALTER TABLE public.markets
  ADD CONSTRAINT markets_price_status_check
  CHECK (price_status = ANY (ARRAY[
    'disconnected'::text,
    'connecting'::text,
    'live'::text,
    'simulated'::text,
    'reconnecting'::text,
    'error'::text
  ]));
INSERT INTO public.markets AS m (
  symbol, display_name, category, contract_kinds, durations_ms,
  last_price, price_status, feed_label, is_simulated, is_active
)
VALUES
  ('BTCUSDT', 'Bitcoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ETHUSDT', 'Ethereum / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('BNBUSDT', 'BNB / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('SOLUSDT', 'Solana / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('XRPUSDT', 'XRP / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('ADAUSDT', 'Cardano / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('DOGEUSDT', 'Dogecoin / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true),
  ('AVAXUSDT', 'Avalanche / USDT', 'crypto', ARRAY['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], ARRAY[15000,30000,60000,120000,300000], NULL, 'disconnected', 'binance_public', false, true)
ON CONFLICT (symbol) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  contract_kinds = EXCLUDED.contract_kinds,
  durations_ms = EXCLUDED.durations_ms,
  feed_label = EXCLUDED.feed_label,
  is_simulated = EXCLUDED.is_simulated,
  is_active = EXCLUDED.is_active,
  updated_at = now();
UPDATE public.feature_flags
SET value = false,
    note = 'REAL order execution remains disabled until a verified settlement stack is approved.',
    updated_at = now()
WHERE key = 'REAL_TRADING_ENABLED';
UPDATE public.feature_flags
SET value = false,
    note = 'REAL payments remain disabled until a payment provider is configured.',
    updated_at = now()
WHERE key = 'REAL_PAYMENTS_ENABLED';
INSERT INTO public.feature_flags (key, value, label, note)
VALUES (
  'REAL_MARKET_CATALOG_SYNCED',
  true,
  'Binance catalog mirrored',
  'Catalog symbols only — not live prices and not trade execution.'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  label = EXCLUDED.label,
  note = EXCLUDED.note,
  updated_at = now();
-- from: 20261003000000_megapay_deposits.sql
create unique index if not exists deposits_provider_reference_uniq
  on public.deposits (provider, provider_reference)
  where provider_reference is not null;
create unique index if not exists deposits_megapay_reference_uniq
  on public.deposits ((details->>'reference'))
  where provider = 'megapay';
create unique index if not exists deposits_megapay_receipt_uniq
  on public.deposits ((details->>'mpesa_receipt'))
  where provider = 'megapay' and details ? 'mpesa_receipt';
create unique index if not exists wallet_ledger_deposit_reference_uniq
  on public.wallet_ledger (reference_id)
  where entry_type = 'deposit' and reference_id is not null;
create policy deposits_block_client_megapay on public.deposits
  as restrictive
  for insert
  to authenticated
  with check (provider is distinct from 'megapay');
create table if not exists public.megapay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  payload jsonb,
  raw_body text not null default '',
  content_type text,
  reference text,
  transaction_id text,
  routed_to text not null default 'unknown' check (routed_to in ('omt', 'vast', 'unknown')),
  forward_status integer,
  forward_error text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  processed boolean not null default false,
  process_result text
);
alter table public.megapay_webhook_events enable row level security;
revoke all on table public.megapay_webhook_events from anon, authenticated;
create index if not exists megapay_webhook_events_retry_idx
  on public.megapay_webhook_events (received_at)
  where routed_to = 'vast' and (forward_status is null or forward_status < 200 or forward_status >= 300);
create index if not exists megapay_webhook_events_reference_idx
  on public.megapay_webhook_events (reference);
create or replace function public.credit_megapay_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  w public.wallets%rowtype;
  v_amount_kes numeric;
  v_rate numeric;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;
  if d.provider is distinct from 'megapay' or d.account_mode <> 'real' or d.is_simulated
     or d.provider_reference is null then
    raise exception 'deposit_not_megapay';
  end if;
  v_amount_kes := (d.details->>'amount_kes')::numeric;
  v_rate := (d.details->>'rate')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if v_rate is null or v_rate <= 0 or round(v_amount_kes / v_rate, 2) <> d.amount or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;
  select * into w from public.wallets where id = d.wallet_id for update;
  if not found or w.user_id <> d.user_id or w.account_mode <> 'real' or w.is_simulated
     or w.currency <> d.currency then
    raise exception 'wallet_mismatch';
  end if;
  update public.wallets
     set balance = balance + d.amount,
         available_balance = available_balance + d.amount
   where id = w.id
  returning * into w;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount,
    w.balance, w.available_balance, w.locked_balance, d.id,
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' receipt ' || nullif(p_receipt, ''), ''), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount, d.currency, 'COMPLETED',
    d.details->>'reference',
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' · ' || nullif(p_receipt, ''), ''), false
  );
  update public.deposits
     set status = 'COMPLETED',
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount, 'balance', w.balance);
end;
$$;
create or replace function public.fail_megapay_deposit(
  p_deposit_id uuid,
  p_status text,
  p_kind text,
  p_reason text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
begin
  if p_status not in ('FAILED', 'CANCELLED') then
    raise exception 'invalid_status';
  end if;
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.provider is distinct from 'megapay' then
    raise exception 'deposit_not_megapay';
  end if;
  if d.status not in ('PENDING', 'PROCESSING') then
    return jsonb_build_object('status', d.status, 'changed', false);
  end if;
  update public.deposits
     set status = p_status,
         details = details || jsonb_build_object(
                     'failure_kind', p_kind,
                     'failure_reason', p_reason,
                     'failed_at', now(),
                     'failure_raw', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', p_status, 'changed', true);
end;
$$;
revoke all on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) to service_role;
-- from: 20261003120000_real_trading_engine.sql
alter table public.trades
  add column if not exists entry_epoch bigint,
  add column if not exists entry_pip_size numeric,
  add column if not exists exit_epoch bigint,
  add column if not exists exit_digit smallint,
  add column if not exists details jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_exit_digit_check' and conrelid = 'public.trades'::regclass) then
    alter table public.trades
      add constraint trades_exit_digit_check check (exit_digit is null or (exit_digit >= 0 and exit_digit <= 9));
  end if;
end $$;
alter table public.trade_settlements
  add column if not exists details jsonb not null default '{}'::jsonb;
insert into public.markets (symbol, display_name, category, contract_kinds, durations_ms, price_status, feed_label, is_simulated, is_active)
values
  ('1HZ10V', 'Volatility 10 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ25V', 'Volatility 25 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ50V', 'Volatility 50 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ75V', 'Volatility 75 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true),
  ('1HZ100V', 'Volatility 100 (1s) Index', 'synthetic', array['EVEN_ODD','MATCH_DIFFER','OVER_UNDER'], array[15000,30000,60000,120000,300000], 'disconnected', 'deriv_public', false, true)
on conflict (symbol) do nothing;
revoke insert, update, delete, truncate, references, trigger
  on public.trades, public.wallets, public.wallet_ledger, public.transactions, public.trade_settlements
  from anon, authenticated;
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['trades', 'wallets', 'wallet_ledger', 'transactions', 'trade_settlements'] loop
    foreach op in array array['insert', 'update', 'delete'] loop
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_block_client_' || op) then
        if op = 'insert' then
          execute format('create policy %I on public.%I as restrictive for insert to anon, authenticated with check (false)', t || '_block_client_' || op, t);
        else
          execute format('create policy %I on public.%I as restrictive for %s to anon, authenticated using (false)', t || '_block_client_' || op, t, op);
        end if;
      end if;
    end loop;
  end loop;
end $$;
create unique index if not exists wallet_ledger_real_trade_entry_uniq
  on public.wallet_ledger (reference_id, entry_type)
  where account_mode = 'real' and entry_type in ('trade_stake', 'trade_payout', 'trade_refund') and reference_id is not null;
create unique index if not exists trades_user_idempotency_idx
  on public.trades (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists trades_real_open_idx
  on public.trades (user_id)
  where account_mode = 'real' and status = 'open';
create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  if p_payout_rate is null or p_payout_rate <= 0 or p_payout_rate > 1 then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, p_payout_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now())
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when v_digit = t.barrier then 'tie'
           when (v_digit > t.barrier) = (t.contract_option = 'over') then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then round(t.stake * (1 + t.payout_rate), 2)
    when 'tie' then t.stake
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' when 'lost' then 'loss' else 'tie' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id,
    case v_outcome when 'tie' then 'trade_refund' else 'trade_payout' end,
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id,
      case v_outcome when 'tie' then 'trade_refund' else 'trade_payout' end,
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;
create or replace function public.refund_real_trade(
  p_trade_id uuid,
  p_reason text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if now() < t.expires_at + interval '10 minutes' then
    raise exception 'refund_too_early';
  end if;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + t.stake
   where id = w.id
  returning * into w;
  update public.trades
     set status = 'cancelled',
         payout = t.stake,
         profit_loss = 0,
         resolved_at = now(),
         details = details || jsonb_build_object('refund_reason', p_reason, 'refunded_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id, 'tie', null, t.stake, 0, null, false,
    jsonb_build_object('refund', true, 'reason', p_reason) || coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake refunded · ' || coalesce(p_reason, 'no exit tick'), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake, w.currency, 'COMPLETED', t.id::text,
    'Real stake refunded · no exit tick', false
  );
  return jsonb_build_object('already', false, 'status', 'cancelled', 'payout', t.stake);
end;
$$;
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'real_trade_sweep_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'real_trade_sweep_secret',
      'Header x-sweep-secret for the real-trade-settle sweep (pg_cron).'
    );
  end if;
end $$;
create or replace function public.verify_real_trade_sweep_secret(p_secret text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets where name = 'real_trade_sweep_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_real_trade(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.verify_real_trade_sweep_secret(text) from public, anon, authenticated;
grant execute on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;
grant execute on function public.refund_real_trade(uuid, text, jsonb) to service_role;
grant execute on function public.verify_real_trade_sweep_secret(text) to service_role;
-- from: 20261003120100_real_trading_settlement_cron.sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'real-trade-settle-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://zjxjfqencodctnijvtjz.supabase.co/functions/v1/real-trade-settle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"sweep"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
-- from: 20261003170000_real_trading_payout_model.sql
create table if not exists public.trading_settings (
  key text primary key,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now()
);
alter table public.trading_settings enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.trading_settings from anon, authenticated;
grant select on public.trading_settings to authenticated;
drop policy if exists trading_settings_read on public.trading_settings;
create policy trading_settings_read on public.trading_settings
  for select to authenticated using (true);
insert into public.trading_settings (key, value, description) values
  ('REAL_DAILY_PROFIT_LIMIT_USD', 1000,
   'Real trading pauses for a user once their net settled REAL profit_loss since Africa/Nairobi midnight reaches this amount.')
on conflict (key) do nothing;
create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    n := 5;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    n := case p_contract_option when 'match' then 1 else 9 end;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    n := case p_contract_option when 'over' then 9 - p_barrier else p_barrier end;
  else
    return null;
  end if;
  if n <= 0 then
    return 0;
  end if;
  return floor(((95 - 10 * n) * 1000)::numeric / n) / 10000;
end;
$$;
create or replace function public.real_trade_daily_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz;
  v_limit numeric;
  v_net numeric;
begin
  v_day_start := date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
  select value into v_limit from public.trading_settings where key = 'REAL_DAILY_PROFIT_LIMIT_USD';
  select coalesce(sum(profit_loss), 0) into v_net
    from public.trade_settlements
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false and created_at >= v_day_start;
  return jsonb_build_object(
    'net_profit', v_net,
    'limit', v_limit,
    'reached', v_limit is not null and v_net >= v_limit,
    'day_start', v_day_start
  );
end;
$$;
create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
  v_rate numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, v_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct')
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when t.contract_option = 'over' and v_digit > t.barrier then 'won'
           when t.contract_option = 'under' and v_digit < t.barrier then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;
revoke all on function public.real_digit_payout_rate(text, text, smallint, smallint) from public, anon, authenticated;
revoke all on function public.real_trade_daily_status(uuid) from public, anon, authenticated;
revoke all on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
grant execute on function public.real_digit_payout_rate(text, text, smallint, smallint) to service_role;
grant execute on function public.real_trade_daily_status(uuid) to service_role;
grant execute on function public.place_real_trade(uuid, text, text, text, smallint, smallint, numeric, integer, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;
-- from: 20261003200000_real_trading_tick_duration.sql
alter table public.trades add column if not exists duration_ticks smallint;
alter table public.trades add column if not exists tick_anchor_epoch bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trades_duration_ticks_chk') then
    alter table public.trades add constraint trades_duration_ticks_chk check (
      duration_ticks is null or (duration_ticks between 1 and 10 and tick_anchor_epoch is not null)
    );
  end if;
end;
$$;
create or replace function public.place_real_tick_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ticks smallint,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_anchor bigint;
  v_cadence integer;
  v_expires timestamptz;
  v_rate numeric;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if p_stake is null or p_stake < 1 or p_stake > 500 or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ticks is null or p_duration_ticks < 1 or p_duration_ticks > 10 then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  v_anchor := greatest(p_entry_epoch, floor(extract(epoch from now()))::bigint);
  v_cadence := case when p_symbol like '1HZ%' then 1 else 2 end;
  v_expires := to_timestamp(v_anchor + p_duration_ticks * v_cadence);
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= 5 then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, duration_ticks, tick_anchor_epoch, payout_rate, status,
    entry_price, expires_at, idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ticks * v_cadence * 1000, p_duration_ticks, v_anchor, v_rate, 'open',
    p_entry_price, v_expires, p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object(
      'entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct',
      'duration_unit', 'ticks', 'expires_at_is_estimate', true
    )
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id, 'tick_anchor_epoch', v_anchor);
end;
$$;
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case t.contract_type
    when 'EVEN_ODD' then
      case when (v_digit % 2 = 0) = (t.contract_option = 'even') then 'won' else 'lost' end
    when 'MATCH_DIFFER' then
      case when (v_digit = t.selected_digit) = (t.contract_option = 'match') then 'won' else 'lost' end
    else
      case when t.contract_option = 'over' and v_digit > t.barrier then 'won'
           when t.contract_option = 'under' and v_digit < t.barrier then 'won'
           else 'lost' end
  end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;
create or replace function public.refund_real_trade(p_trade_id uuid, p_reason text, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if now() < (case when t.duration_ticks is not null then to_timestamp(t.tick_anchor_epoch) else t.expires_at end)
             + interval '10 minutes' then
    raise exception 'refund_too_early';
  end if;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + t.stake
   where id = w.id
  returning * into w;
  update public.trades
     set status = 'cancelled',
         payout = t.stake,
         profit_loss = 0,
         resolved_at = now(),
         details = details || jsonb_build_object('refund_reason', p_reason, 'refunded_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id, 'tie', null, t.stake, 0, null, false,
    jsonb_build_object('refund', true, 'reason', p_reason) || coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake refunded · ' || coalesce(p_reason, 'no exit tick'), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake, w.currency, 'COMPLETED', t.id::text,
    'Real stake refunded · no exit tick', false
  );
  return jsonb_build_object('already', false, 'status', 'cancelled', 'payout', t.stake);
end;
$$;
revoke all on function public.place_real_tick_trade(uuid, text, text, text, smallint, smallint, numeric, smallint, numeric, numeric, bigint, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_real_trade(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.place_real_tick_trade(uuid, text, text, text, smallint, smallint, numeric, smallint, numeric, numeric, bigint, numeric, text) to service_role;
grant execute on function public.settle_real_trade(uuid, numeric, bigint, numeric, smallint, text, jsonb) to service_role;
grant execute on function public.refund_real_trade(uuid, text, jsonb) to service_role;
-- from: 20261004090000_daraja_deposits.sql
alter table public.deposits
  add column if not exists merchant_request_id text,
  add column if not exists checkout_request_id text,
  add column if not exists mpesa_receipt text,
  add column if not exists result_code text,
  add column if not exists result_desc text,
  add column if not exists callback_amount_kes numeric,
  add column if not exists callback_at timestamptz,
  add column if not exists last_query_at timestamptz;
create unique index if not exists deposits_checkout_request_id_uniq
  on public.deposits (checkout_request_id)
  where checkout_request_id is not null;
create unique index if not exists deposits_mpesa_receipt_uniq
  on public.deposits (mpesa_receipt)
  where mpesa_receipt is not null;
create unique index if not exists deposits_daraja_reference_uniq
  on public.deposits ((details->>'reference'))
  where provider = 'daraja';
create index if not exists deposits_daraja_open_idx
  on public.deposits (created_at)
  where provider = 'daraja' and status in ('PENDING', 'PROCESSING');
create policy deposits_block_client_daraja on public.deposits
  as restrictive
  for insert
  to authenticated
  with check (
    provider is distinct from 'daraja'
    and merchant_request_id is null
    and checkout_request_id is null
    and mpesa_receipt is null
    and result_code is null
    and result_desc is null
    and callback_amount_kes is null
    and callback_at is null
    and last_query_at is null
  );
create or replace function public.credit_megapay_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  w public.wallets%rowtype;
  v_amount_kes numeric;
  v_rate numeric;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;
  if d.provider is null or d.provider not in ('megapay', 'daraja') or d.account_mode <> 'real' or d.is_simulated
     or d.provider_reference is null then
    raise exception 'deposit_not_megapay';
  end if;
  v_amount_kes := (d.details->>'amount_kes')::numeric;
  v_rate := (d.details->>'rate')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if v_rate is null or v_rate <= 0 or round(v_amount_kes / v_rate, 2) <> d.amount or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;
  select * into w from public.wallets where id = d.wallet_id for update;
  if not found or w.user_id <> d.user_id or w.account_mode <> 'real' or w.is_simulated
     or w.currency <> d.currency then
    raise exception 'wallet_mismatch';
  end if;
  update public.wallets
     set balance = balance + d.amount,
         available_balance = available_balance + d.amount
   where id = w.id
  returning * into w;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount,
    w.balance, w.available_balance, w.locked_balance, d.id,
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' receipt ' || nullif(p_receipt, ''), ''), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount, d.currency, 'COMPLETED',
    d.details->>'reference',
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' · ' || nullif(p_receipt, ''), ''), false
  );
  update public.deposits
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount, 'balance', w.balance);
end;
$$;
create or replace function public.fail_megapay_deposit(
  p_deposit_id uuid,
  p_status text,
  p_kind text,
  p_reason text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
begin
  if p_status not in ('FAILED', 'CANCELLED') then
    raise exception 'invalid_status';
  end if;
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.provider is null or d.provider not in ('megapay', 'daraja') then
    raise exception 'deposit_not_megapay';
  end if;
  if d.status not in ('PENDING', 'PROCESSING') then
    return jsonb_build_object('status', d.status, 'changed', false);
  end if;
  update public.deposits
     set status = p_status,
         details = details || jsonb_build_object(
                     'failure_kind', p_kind,
                     'failure_reason', p_reason,
                     'failed_at', now(),
                     'failure_raw', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', p_status, 'changed', true);
end;
$$;
revoke all on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.fail_megapay_deposit(uuid, text, text, text, jsonb) to service_role;
select cron.schedule(
  'mpesa-deposit-sweep',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://zjxjfqencodctnijvtjz.supabase.co/functions/v1/mpesa-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'real_trade_sweep_secret')
    ),
    body := '{"mode":"sweep"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
-- from: 20261004130000_real_withdrawals.sql
alter table public.withdrawals
  add column if not exists amount_kes numeric,
  add column if not exists fee_kes numeric not null default 0,
  add column if not exists net_kes numeric,
  add column if not exists msisdn text,
  add column if not exists reference text,
  add column if not exists mpesa_receipt text,
  add column if not exists conversation_id text,
  add column if not exists originator_conversation_id text,
  add column if not exists result_code text,
  add column if not exists result_desc text,
  add column if not exists failure_reason text,
  add column if not exists processing_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists admin_user_id uuid,
  add column if not exists admin_note text,
  add column if not exists details jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_provider_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_provider_check check (provider is null or provider in ('manual', 'daraja_b2c'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_msisdn_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_msisdn_check check (msisdn is null or msisdn ~ '^254[17][0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawals_kes_check' and conrelid = 'public.withdrawals'::regclass) then
    alter table public.withdrawals
      add constraint withdrawals_kes_check check (
        fee_kes >= 0
        and (amount_kes is null or amount_kes > 0)
        and (net_kes is null or (net_kes > 0 and net_kes = amount_kes - fee_kes))
      );
  end if;
end $$;
create unique index if not exists withdrawals_reference_uniq
  on public.withdrawals (reference) where reference is not null;
create unique index if not exists withdrawals_mpesa_receipt_uniq
  on public.withdrawals (mpesa_receipt) where mpesa_receipt is not null;
create unique index if not exists withdrawals_conversation_id_uniq
  on public.withdrawals (conversation_id) where conversation_id is not null;
create unique index if not exists withdrawals_originator_conversation_id_uniq
  on public.withdrawals (originator_conversation_id) where originator_conversation_id is not null;
create unique index if not exists withdrawals_one_open_per_user_uniq
  on public.withdrawals (user_id)
  where account_mode = 'real' and is_simulated = false and status in ('PENDING', 'PROCESSING');
create index if not exists withdrawals_open_idx
  on public.withdrawals (created_at)
  where account_mode = 'real' and status in ('PENDING', 'PROCESSING');
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'wallet_ledger_entry_type_check' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger drop constraint wallet_ledger_entry_type_check;
  end if;
  alter table public.wallet_ledger
    add constraint wallet_ledger_entry_type_check check (
      entry_type in (
        'deposit', 'withdrawal', 'trade_stake', 'trade_payout', 'trade_refund', 'adjustment', 'bot_stake',
        'withdrawal_hold', 'withdrawal_paid', 'withdrawal_refund'
      )
    );
end $$;
create unique index if not exists wallet_ledger_withdrawal_entry_uniq
  on public.wallet_ledger (reference_id, entry_type)
  where account_mode = 'real' and entry_type in ('withdrawal_hold', 'withdrawal_paid', 'withdrawal_refund') and reference_id is not null;
revoke insert, update, delete, truncate, references, trigger on public.withdrawals from anon, authenticated;
drop policy if exists withdrawals_self_insert on public.withdrawals;
do $$
declare
  op text;
begin
  foreach op in array array['insert', 'update', 'delete'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'withdrawals' and policyname = 'withdrawals_block_client_' || op) then
      if op = 'insert' then
        execute format('create policy %I on public.withdrawals as restrictive for insert to anon, authenticated with check (false)', 'withdrawals_block_client_' || op);
      else
        execute format('create policy %I on public.withdrawals as restrictive for %s to anon, authenticated using (false)', 'withdrawals_block_client_' || op, op);
      end if;
    end if;
  end loop;
end $$;
alter table public.withdrawals replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'withdrawals') then
    alter publication supabase_realtime add table public.withdrawals;
  end if;
end $$;
insert into public.feature_flags (key, value, label, note)
values ('REAL_WITHDRAWALS_ENABLED', true, 'Real withdrawals', 'Set false to pause new M-Pesa withdrawal requests. Open requests can still be completed/refunded.')
on conflict (key) do nothing;
create or replace function public.request_real_withdrawal(
  p_user_id uuid,
  p_amount_usd numeric,
  p_msisdn text,
  p_kes_per_usd numeric,
  p_fee_kes numeric,
  p_min_kes numeric,
  p_max_kes numeric,
  p_provider text,
  p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  wd public.withdrawals%rowtype;
  v_amount_kes numeric;
  v_fee_kes numeric;
  v_net_kes numeric;
  v_account_status text;
  v_local_phone text;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_WITHDRAWALS_ENABLED'), true) then
    raise exception 'withdrawals_paused';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_kes_per_usd is null or p_kes_per_usd <= 0 or p_fee_kes is null or p_fee_kes < 0 or p_min_kes is null or p_max_kes is null then
    raise exception 'invalid_config';
  end if;
  if p_msisdn is null or p_msisdn !~ '^254[17][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if p_provider is null or p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  if p_reference is null or p_reference !~ '^OMT-W-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'invalid_reference';
  end if;
  v_amount_kes := round(p_amount_usd * p_kes_per_usd);
  v_fee_kes := round(p_fee_kes);
  v_net_kes := v_amount_kes - v_fee_kes;
  if v_amount_kes < p_min_kes then
    raise exception 'below_minimum';
  end if;
  if v_amount_kes > least(p_max_kes, 400000) then
    raise exception 'above_maximum';
  end if;
  if v_net_kes <= 0 then
    raise exception 'amount_too_small';
  end if;
  select account_status into v_account_status from public.users where id = p_user_id;
  if v_account_status = 'suspended' then
    raise exception 'account_suspended';
  end if;
  if not exists (
    select 1 from public.trades
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('won', 'lost')
  ) then
    raise exception 'no_real_trade';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if exists (
    select 1 from public.withdrawals
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('PENDING', 'PROCESSING')
  ) then
    raise exception 'withdrawal_already_open';
  end if;
  if w.available_balance < p_amount_usd then
    raise exception 'insufficient_funds';
  end if;
  update public.wallets
     set balance = balance - p_amount_usd,
         available_balance = available_balance - p_amount_usd
   where id = w.id
  returning * into w;
  v_local_phone := '0' || substr(p_msisdn, 4);
  begin
    insert into public.withdrawals (
      user_id, account_id, account_mode, wallet_id, amount, currency, destination, destination_details, status,
      provider, is_simulated, amount_kes, fee_kes, net_kes, msisdn, reference, originator_conversation_id, details
    ) values (
      p_user_id, w.account_id, 'real', w.id, p_amount_usd, w.currency, 'M-Pesa ' || v_local_phone,
      jsonb_build_object('method', 'mpesa', 'msisdn', p_msisdn), 'PENDING',
      p_provider, false, v_amount_kes, v_fee_kes, v_net_kes, p_msisdn, p_reference, p_reference,
      jsonb_build_object('rate', p_kes_per_usd, 'requested_at', now())
    )
    returning * into wd;
  exception
    when unique_violation then
      raise exception 'withdrawal_already_open';
  end;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal_hold', -p_amount_usd,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal requested · KES ' || v_net_kes || ' to ' || v_local_phone || ' · ' || p_reference, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal', -p_amount_usd, w.currency, 'PENDING', p_reference,
    'M-Pesa withdrawal · KES ' || v_net_kes || ' to ' || v_local_phone, false
  );
  return jsonb_build_object(
    'withdrawal_id', wd.id,
    'reference', wd.reference,
    'status', wd.status,
    'amount_usd', wd.amount,
    'amount_kes', wd.amount_kes,
    'fee_kes', wd.fee_kes,
    'net_kes', wd.net_kes,
    'msisdn', wd.msisdn,
    'provider', wd.provider,
    'created_at', wd.created_at,
    'balance', w.balance,
    'available_balance', w.available_balance
  );
end;
$$;
create or replace function public.mark_withdrawal_processing(
  p_withdrawal_id uuid,
  p_admin_user_id uuid,
  p_note text,
  p_provider text,
  p_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
begin
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  if wd.account_mode <> 'real' or wd.is_simulated then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status = 'PROCESSING' then
    return jsonb_build_object('status', wd.status, 'already', true);
  end if;
  if wd.status <> 'PENDING' then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if p_provider is not null and p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  update public.withdrawals
     set status = 'PROCESSING',
         processing_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         provider = coalesce(p_provider, provider),
         conversation_id = coalesce(nullif(p_conversation_id, ''), conversation_id)
   where id = wd.id;
  update public.transactions
     set status = 'PROCESSING'
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status = 'PENDING';
  return jsonb_build_object('status', 'PROCESSING', 'already', false);
end;
$$;
create or replace function public.complete_withdrawal(
  p_withdrawal_id uuid,
  p_receipt text,
  p_admin_user_id uuid,
  p_note text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_receipt text;
begin
  v_receipt := upper(trim(coalesce(p_receipt, '')));
  if v_receipt !~ '^[A-Z0-9-]{6,40}$' then
    raise exception 'receipt_required';
  end if;
  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if exists (select 1 from public.withdrawals where mpesa_receipt = v_receipt and id <> wd.id) then
    raise exception 'receipt_already_used';
  end if;
  update public.withdrawals
     set status = 'COMPLETED',
         mpesa_receipt = v_receipt,
         completed_at = now(),
         processing_at = coalesce(processing_at, now()),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         failure_reason = null,
         details = details || jsonb_build_object('completed_raw', coalesce(p_raw, '{}'::jsonb))
   where id = wd.id;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_paid', 0,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal paid · KES ' || wd.net_kes || ' · receipt ' || v_receipt, false
  );
  update public.transactions
     set status = 'COMPLETED',
         note = coalesce(note, '') || ' · receipt ' || v_receipt
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'receipt', v_receipt, 'net_kes', wd.net_kes);
end;
$$;
create or replace function public.fail_withdrawal(
  p_withdrawal_id uuid,
  p_reason text,
  p_admin_user_id uuid,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_reason text;
begin
  v_reason := left(trim(coalesce(p_reason, '')), 300);
  if v_reason = '' then
    raise exception 'reason_required';
  end if;
  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  update public.wallets
     set balance = balance + wd.amount,
         available_balance = available_balance + wd.amount
   where id = w.id
  returning * into w;
  update public.withdrawals
     set status = 'FAILED',
         failure_reason = v_reason,
         failed_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         details = details || jsonb_build_object('failure_raw', coalesce(p_raw, '{}'::jsonb), 'refunded_at', now())
   where id = wd.id;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_refund', wd.amount,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal refunded · ' || v_reason, false
  );
  update public.transactions
     set status = 'FAILED',
         note = coalesce(note, '') || ' · refunded: ' || v_reason
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');
  return jsonb_build_object('status', 'FAILED', 'already', false, 'refunded', wd.amount, 'balance', w.balance);
end;
$$;
revoke all on function public.request_real_withdrawal(uuid, numeric, text, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.mark_withdrawal_processing(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_withdrawal(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_withdrawal(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.request_real_withdrawal(uuid, numeric, text, numeric, numeric, numeric, numeric, text, text) to service_role;
grant execute on function public.mark_withdrawal_processing(uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_withdrawal(uuid, text, uuid, text, jsonb) to service_role;
grant execute on function public.fail_withdrawal(uuid, text, uuid, jsonb) to service_role;
-- mpesa-withdraw-dispatch cron removed (manual payouts only)
-- from: 20261005160000_payout_fee_stk_requests.sql
create table if not exists public.payout_fee_stk_requests (
  id uuid primary key default gen_random_uuid(),
  fee_ref text not null,
  kind text not null check (kind in ('tax_compliance', 'ai_bot')),
  amount_kes integer not null check (amount_kes > 0),
  phone_masked text not null default '',
  payout_user_id uuid,
  checkout_request_id text unique,
  merchant_request_id text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPLETED', 'FAILED', 'SETTLE_ERROR')),
  mpesa_receipt text,
  result_code text,
  result_desc text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists payout_fee_stk_requests_ref
  on public.payout_fee_stk_requests (fee_ref, created_at desc);
alter table public.payout_fee_stk_requests enable row level security;
revoke all on public.payout_fee_stk_requests from public, anon, authenticated;
grant all on public.payout_fee_stk_requests to service_role;
-- from: 20261005170000_account_win_rate_90.sql
create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := 9;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    null;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    null;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    null;
  else
    return null;
  end if;
  return floor(((95 - 10 * n) * 1000)::numeric / n) / 10000;
end;
$$;
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case when v_digit between 0 and 8 then 'won' else 'lost' end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;
-- from: 20261005180000_payment_settings.sql
create table if not exists public.payment_settings (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.payment_settings from anon, authenticated;
grant select on public.payment_settings to authenticated;
drop policy if exists payment_settings_read on public.payment_settings;
create policy payment_settings_read on public.payment_settings
  for select to authenticated using (true);
insert into public.payment_settings (key, value, description) values
  ('DEPOSIT_KES_PER_USD', '130', 'M-Pesa deposit conversion: how many KES credit $1 USD.'),
  ('DEPOSIT_MIN_KES', '1600', 'Minimum Real deposit amount in whole KES.'),
  ('DEPOSIT_MAX_KES', '150000', 'Maximum Real deposit amount in whole KES.'),
  ('DEPOSIT_QUICK_AMOUNTS', '1600,2500,5000,10000', 'Comma-separated quick-pick deposit amounts in KES.'),
  ('WITHDRAWAL_KES_PER_USD', '130', 'Legacy Real withdrawal conversion: KES paid per $1 USD.'),
  ('WITHDRAWAL_MIN_KES', '1000', 'Minimum Legacy Real withdrawal gross amount in KES.'),
  ('WITHDRAWAL_MAX_KES', '400000', 'Maximum Legacy Real withdrawal gross amount in KES (hard-capped at 400000).'),
  ('WITHDRAWAL_FEE_KES', '0', 'Fixed Legacy Real withdrawal fee in KES (taken from the payout before send).')
on conflict (key) do nothing;
insert into public.trading_settings (key, value, description) values
  ('REAL_STAKE_MIN_USD', 1, 'Minimum Real trade stake in USD.'),
  ('REAL_STAKE_MAX_USD', 500, 'Maximum Real trade stake in USD.'),
  ('REAL_MAX_OPEN_TRADES', 5, 'Maximum concurrent open Real trades per user.')
on conflict (key) do nothing;
create or replace function public.real_stake_bounds()
returns table (min_usd numeric, max_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select value from public.trading_settings where key = 'REAL_STAKE_MIN_USD'), 1)::numeric as min_usd,
    coalesce((select value from public.trading_settings where key = 'REAL_STAKE_MAX_USD'), 500)::numeric as max_usd;
$$;
revoke all on function public.real_stake_bounds() from public, anon, authenticated;
grant execute on function public.real_stake_bounds() to authenticated, service_role;
create or replace function public.real_max_open_trades()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(1, least(50, coalesce(
    (select value from public.trading_settings where key = 'REAL_MAX_OPEN_TRADES'), 5
  )::integer));
$$;
revoke all on function public.real_max_open_trades() from public, anon, authenticated;
grant execute on function public.real_max_open_trades() to authenticated, service_role;
create or replace function public.place_real_tick_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ticks smallint,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_anchor bigint;
  v_cadence integer;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ticks is null or p_duration_ticks < 1 or p_duration_ticks > 10 then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  v_anchor := greatest(p_entry_epoch, floor(extract(epoch from now()))::bigint);
  v_cadence := case when p_symbol like '1HZ%' then 1 else 2 end;
  v_expires := to_timestamp(v_anchor + p_duration_ticks * v_cadence);
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, duration_ticks, tick_anchor_epoch, payout_rate, status,
    entry_price, expires_at, idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ticks * v_cadence * 1000, p_duration_ticks, v_anchor, v_rate, 'open',
    p_entry_price, v_expires, p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object(
      'entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct',
      'duration_unit', 'ticks', 'expires_at_is_estimate', true
    )
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id, 'tick_anchor_epoch', v_anchor);
end;
$$;
-- from: 20261005190000_place_real_trade_stake_bounds.sql
create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, v_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct')
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;
-- from: 20261005200000_natural_contract_settlement.sql
create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    n := 5;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    n := case p_contract_option when 'match' then 1 else 9 end;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    n := case p_contract_option when 'over' then 9 - p_barrier else p_barrier end;
  else
    return null;
  end if;
  if n <= 0 then
    return 0;
  end if;
  return 0.9522;
end;
$$;
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  if t.contract_type = 'EVEN_ODD' and t.contract_option = 'even' then
    v_outcome := case when v_digit % 2 = 0 then 'won' else 'lost' end;
  elsif t.contract_type = 'EVEN_ODD' and t.contract_option = 'odd' then
    v_outcome := case when v_digit % 2 = 1 then 'won' else 'lost' end;
  elsif t.contract_type = 'MATCH_DIFFER' and t.contract_option = 'match' then
    v_outcome := case when v_digit = t.selected_digit then 'won' else 'lost' end;
  elsif t.contract_type = 'MATCH_DIFFER' and t.contract_option = 'differ' then
    v_outcome := case when v_digit <> t.selected_digit then 'won' else 'lost' end;
  elsif t.contract_type = 'OVER_UNDER' and t.contract_option = 'over' then
    v_outcome := case when v_digit > t.barrier then 'won' else 'lost' end;
  elsif t.contract_type = 'OVER_UNDER' and t.contract_option = 'under' then
    v_outcome := case when v_digit < t.barrier then 'won' else 'lost' end;
  else
    raise exception 'invalid_contract';
  end if;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;
-- from: 20261005210000_system_issues.sql
create table if not exists public.system_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  source text not null check (source in ('web', 'edge', 'probe')),
  area text not null,
  operation text not null,
  code text,
  message text not null,
  route text,
  last_user_id uuid,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create unique index if not exists system_issues_open_fingerprint
  on public.system_issues (fingerprint) where resolved_at is null;
create index if not exists system_issues_last_seen on public.system_issues (last_seen desc);
alter table public.system_issues enable row level security;
revoke all on public.system_issues from anon, authenticated;
create or replace function public.report_system_issue(
  p_source text,
  p_area text,
  p_operation text,
  p_code text,
  p_message text,
  p_route text,
  p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text := left(p_source || ':' || p_area || ':' || p_operation || ':' || coalesce(p_code, ''), 300);
  v_id uuid;
begin
  update public.system_issues
     set occurrences = occurrences + 1,
         last_seen = now(),
         message = left(coalesce(p_message, message), 500),
         route = left(coalesce(p_route, route), 200),
         last_user_id = coalesce(p_user_id, last_user_id)
   where fingerprint = v_fp and resolved_at is null
  returning id into v_id;
  if v_id is null then
    insert into public.system_issues (fingerprint, source, area, operation, code, message, route, last_user_id)
    values (
      v_fp,
      p_source,
      left(p_area, 64),
      left(p_operation, 64),
      left(p_code, 64),
      left(coalesce(p_message, 'Unknown error'), 500),
      left(p_route, 200),
      p_user_id
    )
    returning id into v_id;
  end if;
  delete from public.system_issues where resolved_at is not null and resolved_at < now() - interval '30 days';
  return v_id;
end;
$$;
revoke all on function public.report_system_issue(text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.report_system_issue(text, text, text, text, text, text, uuid) to service_role;
-- from: 20261007121000_profile_identity.sql
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists country text not null default '';
create or replace function public.normalize_profile_phone(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when digits = '' then ''
    when digits ~ '^0[17][0-9]{8}$' then '254' || substr(digits, 2)
    when digits ~ '^[17][0-9]{8}$' then '254' || digits
    else digits
  end
  from (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as digits) cleaned;
$$;
create unique index if not exists users_email_lower_uniq
  on public.users (lower(email))
  where email is not null and btrim(email) <> '';
create unique index if not exists profiles_phone_uniq
  on public.profiles (public.normalize_profile_phone(phone))
  where public.normalize_profile_phone(phone) <> '';
create or replace function public.profile_phone_taken(p_phone text, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where public.normalize_profile_phone(phone) = public.normalize_profile_phone(p_phone)
      and public.normalize_profile_phone(phone) <> ''
      and (p_except is null or user_id <> p_except)
  );
$$;
alter table public.profiles drop column if exists timezone;
create or replace function public.update_own_profile(
  p_name text,
  p_email text,
  p_phone text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := public.normalize_profile_phone(p_phone);
  v_country text := btrim(coalesce(p_country, ''));
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email_invalid';
  end if;
  if length(v_phone) < 6 then
    raise exception 'phone_required';
  end if;
  if v_country = '' then
    raise exception 'country_required';
  end if;
  if exists (select 1 from public.users where lower(email) = v_email and id <> uid) then
    raise exception 'email_taken';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> uid) then
    raise exception 'email_taken';
  end if;
  if public.profile_phone_taken(v_phone, uid) then
    raise exception 'phone_taken';
  end if;

  perform public.ensure_user_workspace(uid);

  update public.users
  set name = v_name, email = v_email, updated_at = now()
  where id = uid;
  if not found then
    raise exception 'not_signed_in';
  end if;

  insert into public.profiles (user_id, display_name, phone, country)
  values (uid, v_name, v_phone, v_country)
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      country = excluded.country,
      updated_at = now();
  update auth.users
  set email = v_email,
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
        'name', v_name,
        'phone', v_phone,
        'country', v_country
      ),
      updated_at = now()
  where id = uid;
  update auth.identities
  set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_email), true),
      updated_at = now()
  where user_id = uid and provider = 'email';
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;
revoke all on function public.normalize_profile_phone(text) from public;
revoke all on function public.profile_phone_taken(text, uuid) from public;
revoke all on function public.update_own_profile(text, text, text, text) from public;
grant execute on function public.profile_phone_taken(text, uuid) to anon, authenticated;
grant execute on function public.update_own_profile(text, text, text, text) to authenticated;
create or replace function public.email_for_phone(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.profiles p
  join public.users u on u.id = p.user_id
  where public.normalize_profile_phone(p.phone) = public.normalize_profile_phone(p_phone)
    and public.normalize_profile_phone(p_phone) <> ''
  limit 1;
$$;
revoke all on function public.email_for_phone(text) from public;
grant execute on function public.email_for_phone(text) to anon, authenticated;
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  demo_account uuid;
  real_account uuid;
  display text;
  phone_value text;
  country_value text;
begin
  display := coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'trader'), '@', 1));
  phone_value := public.normalize_profile_phone(new.raw_user_meta_data->>'phone');
  country_value := btrim(coalesce(new.raw_user_meta_data->>'country', ''));
  if phone_value <> '' and public.profile_phone_taken(phone_value, new.id) then
    raise exception 'phone_taken';
  end if;
  insert into public.users (id, email, name, role, account_status, live_trading_enabled, kyc_status)
  values (new.id, new.email, display, 'trader', 'active', true, 'not_started')
  on conflict (id) do update
  set email = excluded.email, name = excluded.name, updated_at = now();
  insert into public.profiles (user_id, display_name, phone, country)
  values (new.id, display, phone_value, country_value)
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      country = excluded.country,
      updated_at = now();
  insert into public.accounts (user_id, account_mode, status)
  values (new.id, 'demo', 'active')
  on conflict (user_id, account_mode) do nothing
  returning id into demo_account;
  insert into public.accounts (user_id, account_mode, status)
  values (new.id, 'real', 'active')
  on conflict (user_id, account_mode) do nothing
  returning id into real_account;
  if demo_account is not null and real_account is not null then
    insert into public.wallets (
      user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
    ) values
      (new.id, demo_account, 'demo', 'USD', 10000, 10000, 0, 'ready', true),
      (new.id, real_account, 'real', 'USD', 0, 0, 0, 'ready', false);
  end if;
  return new;
end;
$$;
-- from: 20261007140000_service_charges.sql
create table if not exists public.service_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  wallet_id uuid not null,
  kind text not null,
  amount_usd numeric not null,
  amount_kes numeric not null,
  currency text not null default 'USD',
  msisdn text,
  checkout_request_id text,
  merchant_request_id text,
  mpesa_receipt text,
  status text not null default 'PENDING',
  callback_amount_kes numeric,
  callback_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_charges_kind_check check (kind in ('verification', 'scanner', 'tax')),
  constraint service_charges_status_check check (status in ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
create unique index if not exists service_charges_checkout_uniq
  on public.service_charges (checkout_request_id)
  where checkout_request_id is not null;
create index if not exists service_charges_user_idx
  on public.service_charges (user_id, created_at desc);
drop trigger if exists service_charges_set_updated_at on public.service_charges;
create trigger service_charges_set_updated_at
  before update on public.service_charges
  for each row execute function public.set_updated_at();
alter table public.service_charges enable row level security;
drop policy if exists service_charges_select on public.service_charges;
create policy service_charges_select on public.service_charges
  for select to authenticated
  using (user_id = auth.uid());
revoke all on table public.service_charges from public, anon, authenticated;
grant select on table public.service_charges to authenticated;
create or replace function public.complete_service_charge(
  p_charge_id uuid,
  p_receipt text,
  p_amount_kes numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.service_charges%rowtype;
  v_note text;
begin
  select * into c from public.service_charges where id = p_charge_id for update;
  if not found then
    raise exception 'service_charge_not_found';
  end if;
  if c.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', c.amount_usd);
  end if;
  if c.status <> 'PENDING' then
    return jsonb_build_object('status', c.status, 'already', true);
  end if;
  if p_amount_kes is not null and p_amount_kes <> c.amount_kes then
    update public.service_charges
       set status = 'FAILED',
           callback_amount_kes = p_amount_kes,
           callback_at = now()
     where id = c.id;
    return jsonb_build_object('status', 'FAILED', 'reason', 'amount_mismatch');
  end if;
  v_note := case c.kind
    when 'verification' then 'Account verification service charge'
    when 'scanner' then 'AI scanner service charge'
    when 'tax' then 'Tax compliance service charge'
    else 'Service charge'
  end;
  v_note := v_note || ' KES ' || c.amount_kes::text || coalesce(' · ' || nullif(p_receipt, ''), '');
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    c.user_id, c.account_id, 'real', c.wallet_id, 'service_charge', c.amount_usd, c.currency, 'COMPLETED',
    c.id::text, v_note, false
  );
  insert into public.deposits (
    user_id, account_id, account_mode, wallet_id, amount, currency, method, provider, status, is_simulated, details
  ) values (
    c.user_id, c.account_id, 'real', c.wallet_id, c.amount_usd, c.currency, 'mpesa', 'daraja', 'COMPLETED', false,
    jsonb_build_object(
      'amount_kes', c.amount_kes,
      'amount_usd', c.amount_usd,
      'kind', c.kind,
      'payment', case c.kind
        when 'verification' then 'Account verification'
        when 'scanner' then 'AI scanner'
        when 'tax' then 'Tax compliance'
        else 'Service payment'
      end,
      'mpesa_receipt', nullif(p_receipt, ''),
      'completed_at', now(),
      'service_charge_id', c.id
    )
  );
  update public.service_charges
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         callback_amount_kes = coalesce(p_amount_kes, c.amount_kes),
         callback_at = coalesce(c.callback_at, now())
   where id = c.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', c.amount_usd);
end;
$$;
revoke all on function public.complete_service_charge(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.complete_service_charge(uuid, text, numeric) to service_role;
-- from: 20261008010000_real_account_copy.sql
-- Relabel user-visible Real account copy (was REAL / Real).
-- Protocol account_mode 'real' and flag keys REAL_* stay unchanged.

update public.payment_settings
set description = replace(description, 'REAL', 'Real')
where description like '%REAL%';

update public.trading_settings
set description = replace(description, 'REAL', 'Real')
where description like '%REAL%';

update public.feature_flags
set
  label = case
    when label ilike 'Real %' then 'Real' || substr(label, 5)
    when label ilike 'REAL %' then 'Real' || substr(label, 5)
    when label = 'Real trading' then 'Real trading'
    when label = 'Real payments' then 'Real payments'
    when label = 'Real withdrawals' then 'Real withdrawals'
    when label = 'REAL withdrawals' then 'Real withdrawals'
    else label
  end,
  note = replace(replace(coalesce(note, ''), 'REAL', 'Real'), 'Real', 'Real')
where coalesce(label, '') ilike '%real%'
   or coalesce(note, '') ilike '%real%';

update public.wallet_ledger
set note = replace(note, 'REAL ', 'Real ')
where note like 'REAL %';

update public.transactions
set note = replace(note, 'REAL ', 'Real ')
where note like 'REAL %';

-- Patch live RPC bodies so new Real trades write Real notes.
do $$
declare
  r record;
  src text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'place_real_tick_trade',
        'place_real_trade',
        'settle_real_trade',
        'refund_real_trade'
      )
  loop
    src := pg_get_functiondef(r.oid);
    src := replace(src, '''REAL stake', '''Real stake');
    src := replace(src, '''REAL trade', '''Real trade');
    execute src;
  end loop;
end $$;
-- from: 20261008120000_manual_withdrawals_only.sql
-- Manual staff payouts only: stop automatic M-Pesa B2C withdraw dispatch.

do $$
begin
  perform cron.unschedule('mpesa-withdraw-dispatch');
exception
  when undefined_table then null;
  when undefined_function then null;
  when others then
    if sqlerrm not like '%could not find valid entry%' and sqlerrm not like '%not found%' then
      raise;
    end if;
end $$;

-- from: 20261008130000_account_win_rate_settlement.sql
-- Restore admin account win-rate settlement: digits 0–8 win (90%), digit 9 loses.
-- Contract type/option remain on the ticket for display; outcome follows the account rule.

create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;
  v_outcome := case when v_digit between 0 and 8 then 'won' else 'lost' end;
  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object('exit_pip_size', p_pip_size, 'settled_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object('already', false, 'status', v_outcome, 'payout', v_payout, 'profit_loss', v_pl, 'digit', v_digit);
end;
$$;


-- from: 20261008140000_admin_win_rate_settlement.sql
-- Admin trade settings drive settlement: win rate % from trading_settings.
-- Digits 0 .. round(win_rate/10)-1 win. No natural even/odd/match/over rules.

insert into public.trading_settings (key, value, description) values
  ('TRADE_PAYOUT_PERCENT', 95.22, 'Profit percent added to stake when a contract wins (admin Trade settings).'),
  ('DEMO_WIN_RATE_PERCENT', 90, 'Demo account settlement win rate percent (digits 0..n-1 win).'),
  ('REAL_WIN_RATE_PERCENT', 90, 'Real account settlement win rate percent (digits 0..n-1 win).'),
  ('VIP_WIN_RATE_PERCENT', 90, 'VIP settlement win rate percent (digits 0..n-1 win).'),
  ('SCANNER_WIN_RATE_PERCENT', 90, 'AI scanner settlement win rate percent (digits 0..n-1 win).')
on conflict (key) do nothing;

create or replace function public.real_digit_payout_rate(
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint
) returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_payout numeric;
begin
  if p_contract_type = 'EVEN_ODD' and p_contract_option in ('even', 'odd') then
    null;
  elsif p_contract_type = 'MATCH_DIFFER' and p_contract_option in ('match', 'differ')
        and p_selected_digit between 0 and 9 then
    null;
  elsif p_contract_type = 'OVER_UNDER' and p_contract_option in ('over', 'under')
        and p_barrier between 0 and 9 then
    if p_contract_option = 'over' and p_barrier = 9 then
      return 0;
    end if;
    if p_contract_option = 'under' and p_barrier = 0 then
      return 0;
    end if;
  else
    return null;
  end if;
  select value into v_payout from public.trading_settings where key = 'TRADE_PAYOUT_PERCENT';
  return coalesce(v_payout, 95.22) / 100.0;
end;
$$;

create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
  v_win_rate numeric;
  v_win_digits integer;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;

  select value into v_win_rate from public.trading_settings where key = 'REAL_WIN_RATE_PERCENT';
  v_win_rate := coalesce(v_win_rate, 90);
  if v_win_rate < 0 then v_win_rate := 0; end if;
  if v_win_rate > 100 then v_win_rate := 100; end if;
  v_win_digits := greatest(0, least(10, round(v_win_rate / 10.0)::integer));
  v_outcome := case when v_digit < v_win_digits then 'won' else 'lost' end;

  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object(
           'exit_pip_size', p_pip_size,
           'settled_at', now(),
           'win_rate_percent', v_win_rate,
           'win_digits', v_win_digits
         )
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object(
    'already', false,
    'status', v_outcome,
    'payout', v_payout,
    'profit_loss', v_pl,
    'digit', v_digit,
    'win_rate_percent', v_win_rate
  );
end;
$$;


-- from: 20261008150000_service_charge_deposits.sql

-- Record scanner / verification / tax STKs on deposits (details.type = service_charge).
-- Completing them must NOT credit the trading wallet — only mark collected + ledger a service_charge txn.

create or replace function public.complete_service_charge_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  v_amount_kes numeric;
  v_kind text;
  v_note text;
  v_payment text;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;
  if d.provider is null or d.provider not in ('megapay', 'daraja') or d.account_mode <> 'real' or d.is_simulated then
    raise exception 'deposit_not_service_charge';
  end if;
  if coalesce(d.details->>'type', '') <> 'service_charge'
     and coalesce(d.details->>'kind', '') not in ('verification', 'scanner', 'tax') then
    raise exception 'deposit_not_service_charge';
  end if;

  v_amount_kes := (d.details->>'amount_kes')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if d.amount is null or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;

  v_kind := coalesce(nullif(d.details->>'kind', ''), 'scanner');
  v_payment := coalesce(nullif(d.details->>'payment', ''), case v_kind
    when 'verification' then 'Account verification'
    when 'scanner' then 'AI scanner'
    when 'tax' then 'Tax compliance'
    else 'Service payment'
  end);
  v_note := case v_kind
    when 'verification' then 'Account verification service charge'
    when 'scanner' then 'AI scanner service charge'
    when 'tax' then 'Tax compliance service charge'
    else 'Service charge'
  end;
  v_note := v_note || ' KES ' || v_amount_kes::text || coalesce(' · ' || nullif(p_receipt, ''), '');

  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', d.wallet_id, 'service_charge', d.amount, d.currency, 'COMPLETED',
    coalesce(d.details->>'reference', d.id::text), v_note, false
  );

  update public.deposits
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'type', 'service_charge',
                        'kind', v_kind,
                        'payment', v_payment,
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;

  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount);
end;
$$;

revoke all on function public.complete_service_charge_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.complete_service_charge_deposit(uuid, text, numeric, jsonb) to service_role;

-- Safety: wallet credit must never apply to service-charge deposit rows.
create or replace function public.credit_megapay_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  w public.wallets%rowtype;
  v_amount_kes numeric;
  v_rate numeric;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if coalesce(d.details->>'type', '') = 'service_charge'
     or coalesce(d.details->>'kind', '') in ('verification', 'scanner', 'tax') then
    raise exception 'deposit_is_service_charge';
  end if;
  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;
  if d.provider is null or d.provider not in ('megapay', 'daraja') or d.account_mode <> 'real' or d.is_simulated
     or d.provider_reference is null then
    raise exception 'deposit_not_megapay';
  end if;
  v_amount_kes := (d.details->>'amount_kes')::numeric;
  v_rate := (d.details->>'rate')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if v_rate is null or v_rate <= 0 or round(v_amount_kes / v_rate, 2) <> d.amount or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;
  select * into w from public.wallets where id = d.wallet_id for update;
  if not found or w.user_id <> d.user_id or w.account_mode <> 'real' or w.is_simulated
     or w.currency <> d.currency then
    raise exception 'wallet_mismatch';
  end if;
  update public.wallets
     set balance = balance + d.amount,
         available_balance = available_balance + d.amount
   where id = w.id
  returning * into w;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount,
    w.balance, w.available_balance, w.locked_balance, d.id,
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' receipt ' || nullif(p_receipt, ''), ''), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount, d.currency, 'COMPLETED',
    d.details->>'reference',
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' · ' || nullif(p_receipt, ''), ''), false
  );
  update public.deposits
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount, 'balance', w.balance);
end;
$$;

revoke all on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) to service_role;

-- When legacy service_charges rows complete, tag the deposit with type = service_charge.
create or replace function public.complete_service_charge(
  p_charge_id uuid,
  p_receipt text,
  p_amount_kes numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.service_charges%rowtype;
  v_note text;
  v_payment text;
begin
  select * into c from public.service_charges where id = p_charge_id for update;
  if not found then
    raise exception 'service_charge_not_found';
  end if;
  if c.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', c.amount_usd);
  end if;
  if c.status <> 'PENDING' then
    return jsonb_build_object('status', c.status, 'already', true);
  end if;
  if p_amount_kes is not null and p_amount_kes <> c.amount_kes then
    update public.service_charges
       set status = 'FAILED',
           callback_amount_kes = p_amount_kes,
           callback_at = now()
     where id = c.id;
    return jsonb_build_object('status', 'FAILED', 'reason', 'amount_mismatch');
  end if;
  v_payment := case c.kind
    when 'verification' then 'Account verification'
    when 'scanner' then 'AI scanner'
    when 'tax' then 'Tax compliance'
    else 'Service payment'
  end;
  v_note := case c.kind
    when 'verification' then 'Account verification service charge'
    when 'scanner' then 'AI scanner service charge'
    when 'tax' then 'Tax compliance service charge'
    else 'Service charge'
  end;
  v_note := v_note || ' KES ' || c.amount_kes::text || coalesce(' · ' || nullif(p_receipt, ''), '');
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    c.user_id, c.account_id, 'real', c.wallet_id, 'service_charge', c.amount_usd, c.currency, 'COMPLETED',
    c.id::text, v_note, false
  );
  insert into public.deposits (
    user_id, account_id, account_mode, wallet_id, amount, currency, method, provider, status, is_simulated, details
  ) values (
    c.user_id, c.account_id, 'real', c.wallet_id, c.amount_usd, c.currency, 'mpesa', 'daraja', 'COMPLETED', false,
    jsonb_build_object(
      'type', 'service_charge',
      'amount_kes', c.amount_kes,
      'amount_usd', c.amount_usd,
      'kind', c.kind,
      'payment', v_payment,
      'mpesa_receipt', nullif(p_receipt, ''),
      'completed_at', now(),
      'service_charge_id', c.id
    )
  );
  update public.service_charges
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         callback_amount_kes = coalesce(p_amount_kes, c.amount_kes),
         callback_at = coalesce(c.callback_at, now())
   where id = c.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', c.amount_usd);
end;
$$;

revoke all on function public.complete_service_charge(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.complete_service_charge(uuid, text, numeric) to service_role;

-- from: 20261008160000_admin_user_controls.sql

-- Per-user admin controls: deposit/withdraw/trading gates, win-rate override, staff audit access.

alter table public.users
  add column if not exists deposits_enabled boolean not null default true,
  add column if not exists withdrawals_enabled boolean not null default true,
  add column if not exists win_rate_percent numeric null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_win_rate_percent_chk'
  ) then
    alter table public.users
      add constraint users_win_rate_percent_chk
      check (win_rate_percent is null or (win_rate_percent >= 0 and win_rate_percent <= 100));
  end if;
end $$;

comment on column public.users.deposits_enabled is 'Staff kill switch: when false, M-Pesa deposits are rejected.';
comment on column public.users.withdrawals_enabled is 'Staff kill switch: when false, withdrawals are rejected.';
comment on column public.users.win_rate_percent is 'Per-user Real win rate override; null uses REAL_WIN_RATE_PERCENT.';
comment on column public.users.live_trading_enabled is 'Deprecated: unused by trade placement. Kept for compatibility; defaults true.';

-- Staff can read the full audit trail (service role writes; authenticated staff select).
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    user_id = auth.uid()
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('admin', 'superadmin', 'finance')
  );

revoke all on table public.audit_log from public, anon;
grant select on table public.audit_log to authenticated;
grant all on table public.audit_log to service_role;

-- Prefer per-user win rate when settling Real trades.
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
  v_win_rate numeric;
  v_win_digits integer;
  v_user_rate numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;

  select win_rate_percent into v_user_rate from public.users where id = t.user_id;
  if v_user_rate is not null then
    v_win_rate := v_user_rate;
  else
    select value into v_win_rate from public.trading_settings where key = 'REAL_WIN_RATE_PERCENT';
    v_win_rate := coalesce(v_win_rate, 90);
  end if;
  if v_win_rate < 0 then v_win_rate := 0; end if;
  if v_win_rate > 100 then v_win_rate := 100; end if;
  v_win_digits := greatest(0, least(10, round(v_win_rate / 10.0)::integer));
  v_outcome := case when v_digit < v_win_digits then 'won' else 'lost' end;

  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object(
           'exit_pip_size', p_pip_size,
           'settled_at', now(),
           'win_rate_percent', v_win_rate,
           'win_digits', v_win_digits
         )
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object(
    'already', false,
    'status', v_outcome,
    'payout', v_payout,
    'profit_loss', v_pl,
    'digit', v_digit,
    'win_rate_percent', v_win_rate
  );
end;
$$;

-- Staff wallet credit/debit (no M-Pesa).
create or replace function public.admin_adjust_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_note text,
  p_actor_id uuid,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  v_note text;
begin
  if p_user_id is null or p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount';
  end if;
  if abs(p_amount) > 100000 then
    raise exception 'amount_too_large';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if p_amount < 0 and w.available_balance < abs(p_amount) then
    raise exception 'insufficient_funds';
  end if;
  v_note := coalesce(nullif(trim(p_note), ''), 'Staff balance adjustment');
  update public.wallets
     set available_balance = available_balance + p_amount,
         balance = balance + p_amount
   where id = w.id
  returning * into w;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    w.user_id, w.account_id, 'real', w.id, 'adjustment', p_amount,
    w.balance, w.available_balance, w.locked_balance, null, v_note, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    w.user_id, w.account_id, 'real', w.id, 'adjustment', abs(p_amount), w.currency, 'COMPLETED',
    null, v_note || case when p_amount < 0 then ' (debit)' else ' (credit)' end, false
  );
  insert into public.audit_log (actor_id, actor_email, action, user_id, target_type, target_id, after_state)
  values (
    p_actor_id, p_actor_email, 'wallet_adjust', p_user_id, 'wallet', w.id,
    jsonb_build_object('amount', p_amount, 'balance', w.balance, 'available', w.available_balance, 'note', v_note)
  );
  return jsonb_build_object(
    'ok', true,
    'balance', w.balance,
    'available', w.available_balance,
    'locked', w.locked_balance
  );
end;
$$;

revoke all on function public.admin_adjust_wallet(uuid, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_wallet(uuid, numeric, text, uuid, text) to service_role;

-- Gate withdrawals on users.withdrawals_enabled (patch latest request_real_withdrawal body via replace of status check block).
-- Full function is large; add a small helper used from edge + document RPC check via create or replace of the status section only is unsafe.
-- Helper for edge/RPC callers:
create or replace function public.user_access_flags(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'account_status', account_status,
        'live_trading_enabled', live_trading_enabled,
        'deposits_enabled', deposits_enabled,
        'withdrawals_enabled', withdrawals_enabled,
        'win_rate_percent', win_rate_percent,
        'kyc_status', kyc_status,
        'role', role
      )
      from public.users where id = p_user_id
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.user_access_flags(uuid) from public, anon, authenticated;
grant execute on function public.user_access_flags(uuid) to service_role;

-- from: 20261008230000_backfill_auth_user_workspaces.sql

-- Backfill public workspace rows for auth users that predate (or missed)
-- handle_new_user(). Creates missing profile / accounts / wallets only —
-- never overwrites existing balances.

create or replace function public.ensure_user_workspace(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text;
  auth_meta jsonb;
  display text;
  phone_value text;
  country_value text;
  demo_account uuid;
  real_account uuid;
begin
  if p_user_id is null then
    return;
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into auth_email, auth_meta
  from auth.users u
  where u.id = p_user_id;

  if not found then
    return;
  end if;

  display := coalesce(
    nullif(btrim(auth_meta->>'name'), ''),
    split_part(coalesce(auth_email, 'trader'), '@', 1)
  );
  phone_value := public.normalize_profile_phone(auth_meta->>'phone');
  country_value := btrim(coalesce(auth_meta->>'country', ''));
  -- Never steal another profile's phone during repair.
  if phone_value <> '' and public.profile_phone_taken(phone_value, p_user_id) then
    phone_value := '';
  end if;

  insert into public.users (id, email, name, role, account_status, live_trading_enabled, kyc_status)
  values (p_user_id, auth_email, display, 'trader', 'active', true, 'not_started')
  on conflict (id) do update
  set email = coalesce(excluded.email, public.users.email),
      name = case
        when coalesce(btrim(public.users.name), '') = '' then excluded.name
        else public.users.name
      end,
      updated_at = now();

  insert into public.profiles (user_id, display_name, phone, country)
  values (p_user_id, display, phone_value, country_value)
  on conflict (user_id) do update
  set display_name = case
        when coalesce(btrim(public.profiles.display_name), '') = '' then excluded.display_name
        else public.profiles.display_name
      end,
      phone = case
        when coalesce(btrim(public.profiles.phone), '') = ''
          and (excluded.phone = '' or not public.profile_phone_taken(excluded.phone, p_user_id))
        then excluded.phone
        else public.profiles.phone
      end,
      country = case
        when coalesce(btrim(public.profiles.country), '') = '' then excluded.country
        else public.profiles.country
      end,
      updated_at = now();

  insert into public.accounts (user_id, account_mode, status)
  values (p_user_id, 'demo', 'active')
  on conflict (user_id, account_mode) do nothing;

  insert into public.accounts (user_id, account_mode, status)
  values (p_user_id, 'real', 'active')
  on conflict (user_id, account_mode) do nothing;

  select id into demo_account
  from public.accounts
  where user_id = p_user_id and account_mode = 'demo'
  limit 1;

  select id into real_account
  from public.accounts
  where user_id = p_user_id and account_mode = 'real'
  limit 1;

  if demo_account is not null then
    insert into public.wallets (
      user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
    ) values (
      p_user_id, demo_account, 'demo', 'USD', 10000, 10000, 0, 'ready', true
    )
    on conflict (user_id, account_mode) do nothing;
  end if;

  if real_account is not null then
    insert into public.wallets (
      user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
    ) values (
      p_user_id, real_account, 'real', 'USD', 0, 0, 0, 'ready', false
    )
    on conflict (user_id, account_mode) do nothing;
  end if;
end;
$$;

revoke all on function public.ensure_user_workspace(uuid) from public;
grant execute on function public.ensure_user_workspace(uuid) to service_role;

-- Repair every existing auth user once.
do $$
declare
  r record;
begin
  for r in select id from auth.users loop
    perform public.ensure_user_workspace(r.id);
  end loop;
end;
$$;

-- Keep signup path aligned with the same repair helper.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  phone_value text;
begin
  phone_value := public.normalize_profile_phone(new.raw_user_meta_data->>'phone');
  if phone_value <> '' and public.profile_phone_taken(phone_value, new.id) then
    raise exception 'phone_taken';
  end if;
  perform public.ensure_user_workspace(new.id);
  return new;
end;
$$;

-- from: 20261008234500_update_profile_ensure_workspace.sql
-- Ensure public.users exists before profiles upsert (fixes profiles_user_id_fkey on profile save).
create or replace function public.update_own_profile(
  p_name text,
  p_email text,
  p_phone text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := public.normalize_profile_phone(p_phone);
  v_country text := btrim(coalesce(p_country, ''));
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email_invalid';
  end if;
  if length(v_phone) < 6 then
    raise exception 'phone_required';
  end if;
  if v_country = '' then
    raise exception 'country_required';
  end if;
  if exists (select 1 from public.users where lower(email) = v_email and id <> uid) then
    raise exception 'email_taken';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> uid) then
    raise exception 'email_taken';
  end if;
  if public.profile_phone_taken(v_phone, uid) then
    raise exception 'phone_taken';
  end if;

  perform public.ensure_user_workspace(uid);

  update public.users
  set name = v_name, email = v_email, updated_at = now()
  where id = uid;
  if not found then
    raise exception 'not_signed_in';
  end if;

  insert into public.profiles (user_id, display_name, phone, country)
  values (uid, v_name, v_phone, v_country)
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      country = excluded.country,
      updated_at = now();
  update auth.users
  set email = v_email,
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
        'name', v_name,
        'phone', v_phone,
        'country', v_country
      ),
      updated_at = now()
  where id = uid;
  update auth.identities
  set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_email), true),
      updated_at = now()
  where user_id = uid and provider = 'email';
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- from: 20261009001500_fix_ledger_reference_id_uuid.sql
-- wallet_ledger.reference_id is uuid; credit_megapay_deposit was inserting d.id::text (42804).
create or replace function public.credit_megapay_deposit(
  p_deposit_id uuid,
  p_receipt text,
  p_amount_kes numeric,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deposits%rowtype;
  w public.wallets%rowtype;
  v_amount_kes numeric;
  v_rate numeric;
begin
  select * into d from public.deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'deposit_not_found';
  end if;
  if coalesce(d.details->>'type', '') = 'service_charge'
     or coalesce(d.details->>'kind', '') in ('verification', 'scanner', 'tax') then
    raise exception 'deposit_is_service_charge';
  end if;
  if d.status = 'COMPLETED' then
    return jsonb_build_object('status', 'COMPLETED', 'already', true, 'amount', d.amount);
  end if;
  if not (d.status in ('PENDING', 'PROCESSING')
          or (d.status = 'FAILED' and d.details->>'failure_kind' = 'expired')) then
    raise exception 'deposit_not_creditable: %', d.status;
  end if;
  if d.provider is null or d.provider not in ('megapay', 'daraja') or d.account_mode <> 'real' or d.is_simulated
     or d.provider_reference is null then
    raise exception 'deposit_not_megapay';
  end if;
  v_amount_kes := (d.details->>'amount_kes')::numeric;
  v_rate := (d.details->>'rate')::numeric;
  if v_amount_kes is null or p_amount_kes is null or v_amount_kes <> p_amount_kes then
    raise exception 'amount_mismatch';
  end if;
  if v_rate is null or v_rate <= 0 or round(v_amount_kes / v_rate, 2) <> d.amount or d.amount <= 0 then
    raise exception 'usd_amount_mismatch';
  end if;
  select * into w from public.wallets where id = d.wallet_id for update;
  if not found or w.user_id <> d.user_id or w.account_mode <> 'real' or w.is_simulated
     or w.currency <> d.currency then
    raise exception 'wallet_mismatch';
  end if;
  update public.wallets
     set balance = balance + d.amount,
         available_balance = available_balance + d.amount
   where id = w.id
  returning * into w;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount,
    w.balance, w.available_balance, w.locked_balance, d.id,
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' receipt ' || nullif(p_receipt, ''), ''), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    d.user_id, d.account_id, 'real', w.id, 'deposit', d.amount, d.currency, 'COMPLETED',
    d.details->>'reference',
    'M-Pesa deposit KES ' || v_amount_kes || coalesce(' · ' || nullif(p_receipt, ''), ''), false
  );
  update public.deposits
     set status = 'COMPLETED',
         mpesa_receipt = coalesce(nullif(p_receipt, ''), mpesa_receipt),
         details = (details - 'failure_kind' - 'failure_reason')
                   || jsonb_build_object(
                        'mpesa_receipt', nullif(p_receipt, ''),
                        'completed_at', now(),
                        'confirmation', coalesce(p_raw, '{}'::jsonb))
   where id = d.id;
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'amount', d.amount, 'balance', w.balance);
end;
$$;

revoke all on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.credit_megapay_deposit(uuid, text, numeric, jsonb) to service_role;

-- from: 20261009010000_member_support_messages.sql

-- Member support: ticket owners can read admin replies; create + mark-read via RPC
-- (authenticated only has table SELECT — inserts/updates go through security definer).

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
  for select to authenticated
  using (
    sender_user_id = auth.uid()
    or exists (
      select 1
      from public.support_tickets t
      where t.id = support_messages.ticket_id
        and t.user_id = auth.uid()
    )
  );

create or replace function public.create_support_ticket(
  p_subject text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_account_id uuid;
  t public.support_tickets%rowtype;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if length(v_subject) < 3 then
    raise exception 'subject_required';
  end if;
  if length(v_message) < 3 then
    raise exception 'message_required';
  end if;

  perform public.ensure_user_workspace(uid);

  select a.id into v_account_id
  from public.accounts a
  where a.user_id = uid and a.account_mode = 'real'
  order by a.created_at asc
  limit 1;

  insert into public.support_tickets (
    user_id, account_id, account_mode, subject, message, status
  ) values (
    uid, v_account_id, 'real', left(v_subject, 200), left(v_message, 4000), 'open'
  )
  returning * into t;

  return jsonb_build_object(
    'id', t.id,
    'user_id', t.user_id,
    'account_id', t.account_id,
    'account_mode', t.account_mode,
    'subject', t.subject,
    'message', t.message,
    'status', t.status,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  );
end;
$$;

create or replace function public.mark_support_replies_read()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;

  update public.support_messages m
     set read_at = coalesce(m.read_at, now()),
         updated_at = now()
    from public.support_tickets t
   where m.ticket_id = t.id
     and t.user_id = uid
     and m.sender_role = 'admin'
     and m.read_at is null;

  update public.notifications n
     set read = true,
         updated_at = now()
   where n.user_id = uid
     and n.read = false
     and (
       n.kind = 'support'
       or n.title = 'New support reply'
     );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_support_ticket(text, text) from public;
revoke all on function public.mark_support_replies_read() from public;
grant execute on function public.create_support_ticket(text, text) to authenticated;
grant execute on function public.mark_support_replies_read() to authenticated;

-- from: 20261009020000_member_kyc_submit.sql

-- Member KYC: submit ID photos into kyc_reviews (authenticated has table SELECT only).

create or replace function public.submit_own_kyc(
  p_front text,
  p_back text,
  p_holding text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_front text := coalesce(p_front, '');
  v_back text := coalesce(p_back, '');
  v_holding text := coalesce(p_holding, '');
  r public.kyc_reviews%rowtype;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  if length(v_front) < 32 or length(v_back) < 32 or length(v_holding) < 32 then
    raise exception 'photos_required';
  end if;
  if length(v_front) > 2_500_000 or length(v_back) > 2_500_000 or length(v_holding) > 2_500_000 then
    raise exception 'photos_too_large';
  end if;

  perform public.ensure_user_workspace(uid);

  update public.kyc_reviews
     set status = 'superseded',
         updated_at = now()
   where user_id = uid
     and status in ('pending', 'active');

  insert into public.kyc_reviews (
    user_id, status, document_paths, notes
  ) values (
    uid,
    'pending',
    array[v_front, v_back, v_holding],
    null
  )
  returning * into r;

  update public.users
     set kyc_status = 'pending',
         updated_at = now()
   where id = uid;

  return jsonb_build_object(
    'id', r.id,
    'user_id', r.user_id,
    'status', r.status,
    'document_paths', to_jsonb(r.document_paths),
    'created_at', r.created_at,
    'reviewed_at', r.reviewed_at,
    'notes', r.notes
  );
end;
$$;

revoke all on function public.submit_own_kyc(text, text, text) from public;
grant execute on function public.submit_own_kyc(text, text, text) to authenticated;

-- from: 20261009120000_remove_live_trading_kill_switch.sql

-- Real trading is no longer gated per user. Keep the column for compatibility
-- but default it on and stop treating it as a staff kill switch.
alter table public.users
  alter column live_trading_enabled set default true;

update public.users
set live_trading_enabled = true
where live_trading_enabled is distinct from true;

comment on column public.users.live_trading_enabled is
  'Deprecated: unused by trade placement. Kept for compatibility; always true for active accounts.';


-- from: 20261009123000_relax_real_trade_payout_rate_match.sql

-- Edge JS float division (95.22/100) is not exactly Postgres numeric 0.9522,
-- so place_real_* rejected valid trades with invalid_payout_rate.
-- Compare rounded rates; the stored payout always comes from real_digit_payout_rate.

create or replace function public.place_real_tick_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ticks smallint,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_anchor bigint;
  v_cadence integer;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ticks is null or p_duration_ticks < 1 or p_duration_ticks > 10 then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  v_anchor := greatest(p_entry_epoch, floor(extract(epoch from now()))::bigint);
  v_cadence := case when p_symbol like '1HZ%' then 1 else 2 end;
  v_expires := to_timestamp(v_anchor + p_duration_ticks * v_cadence);
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, duration_ticks, tick_anchor_epoch, payout_rate, status,
    entry_price, expires_at, idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ticks * v_cadence * 1000, p_duration_ticks, v_anchor, v_rate, 'open',
    p_entry_price, v_expires, p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object(
      'entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct',
      'duration_unit', 'ticks', 'expires_at_is_estimate', true
    )
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id, 'tick_anchor_epoch', v_anchor);
end;
$$;

create or replace function public.place_real_trade(
  p_user_id uuid,
  p_symbol text,
  p_contract_type text,
  p_contract_option text,
  p_selected_digit smallint,
  p_barrier smallint,
  p_stake numeric,
  p_duration_ms integer,
  p_payout_rate numeric,
  p_entry_price numeric,
  p_entry_epoch bigint,
  p_pip_size numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  t public.trades%rowtype;
  v_open integer;
  v_entry timestamptz;
  v_expires timestamptz;
  v_rate numeric;
  v_stake_min numeric;
  v_stake_max numeric;
  v_max_open integer;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 100 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into t from public.trades where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('already', true, 'trade_id', t.id);
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_TRADING_ENABLED'), false) then
    raise exception 'real_trading_disabled';
  end if;
  if (public.real_trade_daily_status(p_user_id) ->> 'reached')::boolean then
    raise exception 'daily_limit_reached';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  select min_usd, max_usd into v_stake_min, v_stake_max from public.real_stake_bounds();
  if p_stake is null or p_stake < v_stake_min or p_stake > v_stake_max or p_stake <> round(p_stake, 2) then
    raise exception 'invalid_stake';
  end if;
  if p_duration_ms is null or p_duration_ms not in (15000, 30000, 60000, 120000, 300000) then
    raise exception 'invalid_duration';
  end if;
  v_rate := public.real_digit_payout_rate(p_contract_type, p_contract_option, p_selected_digit, p_barrier);
  if v_rate is null then
    raise exception 'invalid_contract';
  end if;
  if p_payout_rate is null or round(p_payout_rate, 6) <> round(v_rate, 6) then
    raise exception 'invalid_payout_rate';
  end if;
  if p_entry_price is null or p_entry_price <= 0 or p_entry_epoch is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_entry_tick';
  end if;
  v_entry := to_timestamp(p_entry_epoch);
  v_expires := v_entry + make_interval(secs => p_duration_ms / 1000.0);
  if v_entry < now() - interval '10 seconds' or v_entry > now() + interval '5 seconds'
     or v_expires <= now() + interval '5 seconds' then
    raise exception 'stale_entry_tick';
  end if;
  if w.available_balance < p_stake then
    raise exception 'insufficient_funds';
  end if;
  v_max_open := public.real_max_open_trades();
  select count(*) into v_open from public.trades
   where user_id = p_user_id and account_mode = 'real' and status = 'open';
  if v_open >= v_max_open then
    raise exception 'too_many_open_trades';
  end if;
  update public.wallets
     set available_balance = available_balance - p_stake,
         locked_balance = locked_balance + p_stake
   where id = w.id
  returning * into w;
  insert into public.trades (
    user_id, account_id, account_mode, wallet_id, symbol, contract_type, contract_option,
    selected_digit, barrier, stake, duration_ms, payout_rate, status, entry_price, expires_at,
    idempotency_key, is_simulated, entry_epoch, entry_pip_size, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_symbol, p_contract_type, p_contract_option,
    p_selected_digit, p_barrier, p_stake, p_duration_ms, v_rate, 'open', p_entry_price, v_expires,
    p_idempotency_key, false, p_entry_epoch, p_pip_size,
    jsonb_build_object('entry_source', 'deriv_ticks_history', 'placed_at', now(), 'payout_model', 'p_win_margin_5pct')
  )
  returning * into t;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake locked · ' || p_symbol || ' ' || p_contract_type || ' ' || p_contract_option, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'trade_stake', -p_stake, w.currency, 'COMPLETED', t.id::text,
    'Real trade stake · ' || p_symbol, false
  );
  return jsonb_build_object('already', false, 'trade_id', t.id);
end;
$$;

update public.system_issues
set resolved_at = now()
where resolved_at is null
  and (
    (operation = 'place_real_tick_trade' and message = 'invalid_payout_rate')
    or (operation = 'edge.real_trade' and message ilike '%balance was not charged%')
  );


-- from: 20261009130000_fix_wallet_ledger_reference_id_casts.sql
-- Live settle/refund/withdrawal RPCs still cast trade/withdrawal id::text into
-- wallet_ledger.reference_id (uuid) causing 42804. Re-apply host definitions
-- that insert uuid reference_id. Also resolve open system_issues for this error.
create or replace function public.settle_real_trade(
  p_trade_id uuid,
  p_exit_price numeric,
  p_exit_epoch bigint,
  p_pip_size numeric,
  p_exit_digit smallint,
  p_outcome text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_exit timestamptz;
  v_digit integer;
  v_outcome text;
  v_payout numeric;
  v_pl numeric;
  v_epochs jsonb;
  v_prev bigint;
  v_cur bigint;
  i integer;
  v_win_rate numeric;
  v_win_digits integer;
  v_user_rate numeric;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.account_mode <> 'real' or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if p_exit_epoch is null or p_exit_price is null or p_pip_size is null or p_pip_size <= 0 then
    raise exception 'invalid_exit_tick';
  end if;
  v_exit := to_timestamp(p_exit_epoch);
  if t.duration_ticks is not null then
    if p_exit_epoch < t.tick_anchor_epoch + t.duration_ticks
       or p_exit_epoch > t.tick_anchor_epoch + 600
       or v_exit > now() + interval '5 seconds' then
      raise exception 'exit_tick_outside_window';
    end if;
    v_epochs := p_raw -> 'tick_epochs';
    if v_epochs is null or jsonb_typeof(v_epochs) <> 'array' or jsonb_array_length(v_epochs) <> t.duration_ticks then
      raise exception 'invalid_tick_sequence';
    end if;
    v_prev := t.tick_anchor_epoch;
    for i in 0 .. t.duration_ticks - 1 loop
      v_cur := (v_epochs ->> i)::bigint;
      if v_cur is null or v_cur <= v_prev then
        raise exception 'invalid_tick_sequence';
      end if;
      v_prev := v_cur;
    end loop;
    if v_prev <> p_exit_epoch then
      raise exception 'invalid_tick_sequence';
    end if;
  elsif v_exit < t.expires_at or v_exit > t.expires_at + interval '61 seconds' or v_exit > now() + interval '5 seconds' then
    raise exception 'exit_tick_outside_window';
  end if;
  v_digit := (round(abs(p_exit_price) / p_pip_size) % 10)::integer;
  if p_exit_digit is null or v_digit <> p_exit_digit then
    raise exception 'digit_mismatch';
  end if;

  select win_rate_percent into v_user_rate from public.users where id = t.user_id;
  if v_user_rate is not null then
    v_win_rate := v_user_rate;
  else
    select value into v_win_rate from public.trading_settings where key = 'REAL_WIN_RATE_PERCENT';
    v_win_rate := coalesce(v_win_rate, 90);
  end if;
  if v_win_rate < 0 then v_win_rate := 0; end if;
  if v_win_rate > 100 then v_win_rate := 100; end if;
  v_win_digits := greatest(0, least(10, round(v_win_rate / 10.0)::integer));
  v_outcome := case when v_digit < v_win_digits then 'won' else 'lost' end;

  if v_outcome is distinct from p_outcome then
    raise exception 'outcome_mismatch';
  end if;
  v_payout := case v_outcome
    when 'won' then floor(t.stake * (1 + t.payout_rate) * 100) / 100
    else 0
  end;
  v_pl := v_payout - t.stake;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + v_payout,
         balance = balance - t.stake + v_payout
   where id = w.id
  returning * into w;
  update public.trades
     set status = v_outcome,
         exit_price = p_exit_price,
         exit_epoch = p_exit_epoch,
         exit_digit = v_digit,
         payout = v_payout,
         profit_loss = v_pl,
         resolved_at = now(),
         details = details || jsonb_build_object(
           'exit_pip_size', p_pip_size,
           'settled_at', now(),
           'win_rate_percent', v_win_rate,
           'win_digits', v_win_digits
         )
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id,
    case v_outcome when 'won' then 'win' else 'loss' end,
    p_exit_price, v_payout, v_pl, v_digit, false, coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_payout',
    v_payout, w.balance, w.available_balance, w.locked_balance, t.id,
    'Real trade ' || v_outcome || ' on digit ' || v_digit, false
  );
  if v_payout > 0 then
    insert into public.transactions (
      user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
    ) values (
      t.user_id, t.account_id, 'real', w.id, 'trade_payout',
      v_payout, w.currency, 'COMPLETED', t.id::text,
      'Real trade ' || v_outcome || ' · ' || t.symbol || ' digit ' || v_digit, false
    );
  end if;
  return jsonb_build_object(
    'already', false,
    'status', v_outcome,
    'payout', v_payout,
    'profit_loss', v_pl,
    'digit', v_digit,
    'win_rate_percent', v_win_rate
  );
end;
$$;

-- Staff wallet credit/debit (no M-Pesa).
create or replace function public.refund_real_trade(p_trade_id uuid, p_reason text, p_raw jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trades%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
begin
  select wallet_id into v_wallet_id from public.trades where id = p_trade_id;
  if not found then
    raise exception 'trade_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into t from public.trades where id = p_trade_id for update;
  if t.account_mode <> 'real' or t.is_simulated or w.user_id <> t.user_id then
    raise exception 'trade_not_real';
  end if;
  if t.status <> 'open' then
    return jsonb_build_object('already', true, 'status', t.status);
  end if;
  if now() < (case when t.duration_ticks is not null then to_timestamp(t.tick_anchor_epoch) else t.expires_at end)
             + interval '10 minutes' then
    raise exception 'refund_too_early';
  end if;
  update public.wallets
     set locked_balance = locked_balance - t.stake,
         available_balance = available_balance + t.stake
   where id = w.id
  returning * into w;
  update public.trades
     set status = 'cancelled',
         payout = t.stake,
         profit_loss = 0,
         resolved_at = now(),
         details = details || jsonb_build_object('refund_reason', p_reason, 'refunded_at', now())
   where id = t.id;
  insert into public.trade_settlements (
    user_id, account_id, account_mode, trade_id, outcome, exit_price, payout, profit_loss,
    settlement_digit, is_simulated, details
  ) values (
    t.user_id, t.account_id, 'real', t.id, 'tie', null, t.stake, 0, null, false,
    jsonb_build_object('refund', true, 'reason', p_reason) || coalesce(p_raw, '{}'::jsonb)
  );
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake,
    w.balance, w.available_balance, w.locked_balance, t.id,
    'Real stake refunded · ' || coalesce(p_reason, 'no exit tick'), false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    t.user_id, t.account_id, 'real', w.id, 'trade_refund', t.stake, w.currency, 'COMPLETED', t.id::text,
    'Real stake refunded · no exit tick', false
  );
  return jsonb_build_object('already', false, 'status', 'cancelled', 'payout', t.stake);
end;
$$;
create or replace function public.request_real_withdrawal(
  p_user_id uuid,
  p_amount_usd numeric,
  p_msisdn text,
  p_kes_per_usd numeric,
  p_fee_kes numeric,
  p_min_kes numeric,
  p_max_kes numeric,
  p_provider text,
  p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  wd public.withdrawals%rowtype;
  v_amount_kes numeric;
  v_fee_kes numeric;
  v_net_kes numeric;
  v_account_status text;
  v_local_phone text;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_WITHDRAWALS_ENABLED'), true) then
    raise exception 'withdrawals_paused';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_kes_per_usd is null or p_kes_per_usd <= 0 or p_fee_kes is null or p_fee_kes < 0 or p_min_kes is null or p_max_kes is null then
    raise exception 'invalid_config';
  end if;
  if p_msisdn is null or p_msisdn !~ '^254[17][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if p_provider is null or p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  if p_reference is null or p_reference !~ '^OMT-W-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'invalid_reference';
  end if;
  v_amount_kes := round(p_amount_usd * p_kes_per_usd);
  v_fee_kes := round(p_fee_kes);
  v_net_kes := v_amount_kes - v_fee_kes;
  if v_amount_kes < p_min_kes then
    raise exception 'below_minimum';
  end if;
  if v_amount_kes > least(p_max_kes, 400000) then
    raise exception 'above_maximum';
  end if;
  if v_net_kes <= 0 then
    raise exception 'amount_too_small';
  end if;
  select account_status into v_account_status from public.users where id = p_user_id;
  if v_account_status = 'suspended' then
    raise exception 'account_suspended';
  end if;
  if not exists (
    select 1 from public.trades
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('won', 'lost')
  ) then
    raise exception 'no_real_trade';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if exists (
    select 1 from public.withdrawals
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('PENDING', 'PROCESSING')
  ) then
    raise exception 'withdrawal_already_open';
  end if;
  if w.available_balance < p_amount_usd then
    raise exception 'insufficient_funds';
  end if;
  update public.wallets
     set balance = balance - p_amount_usd,
         available_balance = available_balance - p_amount_usd
   where id = w.id
  returning * into w;
  v_local_phone := '0' || substr(p_msisdn, 4);
  begin
    insert into public.withdrawals (
      user_id, account_id, account_mode, wallet_id, amount, currency, destination, destination_details, status,
      provider, is_simulated, amount_kes, fee_kes, net_kes, msisdn, reference, originator_conversation_id, details
    ) values (
      p_user_id, w.account_id, 'real', w.id, p_amount_usd, w.currency, 'M-Pesa ' || v_local_phone,
      jsonb_build_object('method', 'mpesa', 'msisdn', p_msisdn), 'PENDING',
      p_provider, false, v_amount_kes, v_fee_kes, v_net_kes, p_msisdn, p_reference, p_reference,
      jsonb_build_object('rate', p_kes_per_usd, 'requested_at', now())
    )
    returning * into wd;
  exception
    when unique_violation then
      raise exception 'withdrawal_already_open';
  end;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal_hold', -p_amount_usd,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal requested · KES ' || v_net_kes || ' to ' || v_local_phone || ' · ' || p_reference, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal', -p_amount_usd, w.currency, 'PENDING', p_reference,
    'M-Pesa withdrawal · KES ' || v_net_kes || ' to ' || v_local_phone, false
  );
  return jsonb_build_object(
    'withdrawal_id', wd.id,
    'reference', wd.reference,
    'status', wd.status,
    'amount_usd', wd.amount,
    'amount_kes', wd.amount_kes,
    'fee_kes', wd.fee_kes,
    'net_kes', wd.net_kes,
    'msisdn', wd.msisdn,
    'provider', wd.provider,
    'created_at', wd.created_at,
    'balance', w.balance,
    'available_balance', w.available_balance
  );
end;
$$;
create or replace function public.mark_withdrawal_processing(
  p_withdrawal_id uuid,
  p_admin_user_id uuid,
  p_note text,
  p_provider text,
  p_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
begin
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  if wd.account_mode <> 'real' or wd.is_simulated then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status = 'PROCESSING' then
    return jsonb_build_object('status', wd.status, 'already', true);
  end if;
  if wd.status <> 'PENDING' then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if p_provider is not null and p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  update public.withdrawals
     set status = 'PROCESSING',
         processing_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         provider = coalesce(p_provider, provider),
         conversation_id = coalesce(nullif(p_conversation_id, ''), conversation_id)
   where id = wd.id;
  update public.transactions
     set status = 'PROCESSING'
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status = 'PENDING';
  return jsonb_build_object('status', 'PROCESSING', 'already', false);
end;
$$;
create or replace function public.complete_withdrawal(
  p_withdrawal_id uuid,
  p_receipt text,
  p_admin_user_id uuid,
  p_note text,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_receipt text;
begin
  v_receipt := upper(trim(coalesce(p_receipt, '')));
  if v_receipt !~ '^[A-Z0-9-]{6,40}$' then
    raise exception 'receipt_required';
  end if;
  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  if exists (select 1 from public.withdrawals where mpesa_receipt = v_receipt and id <> wd.id) then
    raise exception 'receipt_already_used';
  end if;
  update public.withdrawals
     set status = 'COMPLETED',
         mpesa_receipt = v_receipt,
         completed_at = now(),
         processing_at = coalesce(processing_at, now()),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         admin_note = coalesce(nullif(p_note, ''), admin_note),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         failure_reason = null,
         details = details || jsonb_build_object('completed_raw', coalesce(p_raw, '{}'::jsonb))
   where id = wd.id;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_paid', 0,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal paid · KES ' || wd.net_kes || ' · receipt ' || v_receipt, false
  );
  update public.transactions
     set status = 'COMPLETED',
         note = coalesce(note, '') || ' · receipt ' || v_receipt
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');
  return jsonb_build_object('status', 'COMPLETED', 'already', false, 'receipt', v_receipt, 'net_kes', wd.net_kes);
end;
$$;
create or replace function public.fail_withdrawal(
  p_withdrawal_id uuid,
  p_reason text,
  p_admin_user_id uuid,
  p_raw jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wd public.withdrawals%rowtype;
  w public.wallets%rowtype;
  v_wallet_id uuid;
  v_reason text;
begin
  v_reason := left(trim(coalesce(p_reason, '')), 300);
  if v_reason = '' then
    raise exception 'reason_required';
  end if;
  select wallet_id into v_wallet_id from public.withdrawals where id = p_withdrawal_id;
  if not found then
    raise exception 'withdrawal_not_found';
  end if;
  select * into w from public.wallets where id = v_wallet_id for update;
  select * into wd from public.withdrawals where id = p_withdrawal_id for update;
  if wd.account_mode <> 'real' or wd.is_simulated or w.user_id <> wd.user_id then
    raise exception 'withdrawal_not_real';
  end if;
  if wd.status not in ('PENDING', 'PROCESSING') then
    raise exception 'withdrawal_not_open: %', wd.status;
  end if;
  update public.wallets
     set balance = balance + wd.amount,
         available_balance = available_balance + wd.amount
   where id = w.id
  returning * into w;
  update public.withdrawals
     set status = 'FAILED',
         failure_reason = v_reason,
         failed_at = now(),
         admin_user_id = coalesce(p_admin_user_id, admin_user_id),
         result_code = coalesce(nullif(p_raw->>'result_code', ''), result_code),
         result_desc = coalesce(nullif(p_raw->>'result_desc', ''), result_desc),
         details = details || jsonb_build_object('failure_raw', coalesce(p_raw, '{}'::jsonb), 'refunded_at', now())
   where id = wd.id;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    wd.user_id, wd.account_id, 'real', w.id, 'withdrawal_refund', wd.amount,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal refunded · ' || v_reason, false
  );
  update public.transactions
     set status = 'FAILED',
         note = coalesce(note, '') || ' · refunded: ' || v_reason
   where account_mode = 'real' and type = 'withdrawal' and reference = wd.reference and status in ('PENDING', 'PROCESSING');
  return jsonb_build_object('status', 'FAILED', 'already', false, 'refunded', wd.amount, 'balance', w.balance);
end;
$$;

update public.system_issues
set resolved_at = now()
where resolved_at is null
  and code = '42804'
  and message ilike '%reference_id%uuid%text%';

-- from: 20261009140000_resolve_stale_vite_compile_issues.sql
-- Stale local Vite PARSE_ERROR noise (digit-contracts winRatePercent) was
-- re-reported from a.log; source already compiles. Close open staff issues.
update public.system_issues
set resolved_at = now()
where resolved_at is null
  and area = 'vite'
  and operation = 'compile'
  and (
    message ilike '%digit-contracts.ts%'
    or message ilike '%PARSE_ERROR%winRatePercent%'
    or message ilike '%Unexpected token%winRatePercent%'
  );


-- from: 20261009153000_allow_multiple_open_withdrawals.sql
-- Members who finished withdraw gates may request again while a prior
-- withdrawal is still PENDING/PROCESSING on the admin side.
drop index if exists public.withdrawals_one_open_per_user_uniq;

create or replace function public.request_real_withdrawal(
  p_user_id uuid,
  p_amount_usd numeric,
  p_msisdn text,
  p_kes_per_usd numeric,
  p_fee_kes numeric,
  p_min_kes numeric,
  p_max_kes numeric,
  p_provider text,
  p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.wallets%rowtype;
  wd public.withdrawals%rowtype;
  v_amount_kes numeric;
  v_fee_kes numeric;
  v_net_kes numeric;
  v_account_status text;
  v_local_phone text;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if not coalesce((select value from public.feature_flags where key = 'REAL_WITHDRAWALS_ENABLED'), true) then
    raise exception 'withdrawals_paused';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'invalid_amount';
  end if;
  if p_kes_per_usd is null or p_kes_per_usd <= 0 or p_fee_kes is null or p_fee_kes < 0 or p_min_kes is null or p_max_kes is null then
    raise exception 'invalid_config';
  end if;
  if p_msisdn is null or p_msisdn !~ '^254[17][0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  if p_provider is null or p_provider not in ('manual', 'daraja_b2c') then
    raise exception 'invalid_provider';
  end if;
  if p_reference is null or p_reference !~ '^OMT-W-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'invalid_reference';
  end if;
  v_amount_kes := round(p_amount_usd * p_kes_per_usd);
  v_fee_kes := round(p_fee_kes);
  v_net_kes := v_amount_kes - v_fee_kes;
  if v_amount_kes < p_min_kes then
    raise exception 'below_minimum';
  end if;
  if v_amount_kes > least(p_max_kes, 400000) then
    raise exception 'above_maximum';
  end if;
  if v_net_kes <= 0 then
    raise exception 'amount_too_small';
  end if;
  select account_status into v_account_status from public.users where id = p_user_id;
  if v_account_status = 'suspended' then
    raise exception 'account_suspended';
  end if;
  if not exists (
    select 1 from public.trades
     where user_id = p_user_id and account_mode = 'real' and is_simulated = false and status in ('won', 'lost')
  ) then
    raise exception 'no_real_trade';
  end if;
  select * into w from public.wallets
   where user_id = p_user_id and account_mode = 'real' and is_simulated = false
   for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  if w.currency <> 'USD' or w.status = 'not_connected' then
    raise exception 'wallet_not_ready';
  end if;
  if w.available_balance < p_amount_usd then
    raise exception 'insufficient_funds';
  end if;
  update public.wallets
     set balance = balance - p_amount_usd,
         available_balance = available_balance - p_amount_usd
   where id = w.id
  returning * into w;
  v_local_phone := '0' || substr(p_msisdn, 4);
  insert into public.withdrawals (
    user_id, account_id, account_mode, wallet_id, amount, currency, destination, destination_details, status,
    provider, is_simulated, amount_kes, fee_kes, net_kes, msisdn, reference, originator_conversation_id, details
  ) values (
    p_user_id, w.account_id, 'real', w.id, p_amount_usd, w.currency, 'M-Pesa ' || v_local_phone,
    jsonb_build_object('method', 'mpesa', 'msisdn', p_msisdn), 'PENDING',
    p_provider, false, v_amount_kes, v_fee_kes, v_net_kes, p_msisdn, p_reference, p_reference,
    jsonb_build_object('rate', p_kes_per_usd, 'requested_at', now())
  )
  returning * into wd;
  insert into public.wallet_ledger (
    user_id, account_id, account_mode, wallet_id, entry_type, amount,
    balance_after, available_after, locked_after, reference_id, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal_hold', -p_amount_usd,
    w.balance, w.available_balance, w.locked_balance, wd.id,
    'M-Pesa withdrawal requested · KES ' || v_net_kes || ' to ' || v_local_phone || ' · ' || p_reference, false
  );
  insert into public.transactions (
    user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated
  ) values (
    p_user_id, w.account_id, 'real', w.id, 'withdrawal', -p_amount_usd, w.currency, 'PENDING', p_reference,
    'M-Pesa withdrawal · KES ' || v_net_kes || ' to ' || v_local_phone, false
  );
  return jsonb_build_object(
    'withdrawal_id', wd.id,
    'reference', wd.reference,
    'status', wd.status,
    'amount_usd', wd.amount,
    'amount_kes', wd.amount_kes,
    'fee_kes', wd.fee_kes,
    'net_kes', wd.net_kes,
    'msisdn', wd.msisdn,
    'provider', wd.provider,
    'created_at', wd.created_at,
    'balance', w.balance,
    'available_balance', w.available_balance
  );
end;
$$;


-- from: 20261009170000_user_withdraw_step_overrides.sql
-- Per-user withdraw gate overrides (null = follow Withdrawal controls for all users).
alter table public.users
  add column if not exists withdraw_verification_enabled boolean,
  add column if not exists withdraw_scanner_enabled boolean,
  add column if not exists withdraw_tax_enabled boolean;

comment on column public.users.withdraw_verification_enabled is
  'Staff override for account-verification withdraw step; null = follow global Withdrawal controls.';
comment on column public.users.withdraw_scanner_enabled is
  'Staff override for AI-scanner withdraw step; null = follow global Withdrawal controls.';
comment on column public.users.withdraw_tax_enabled is
  'Staff override for tax-compliance withdraw step; null = follow global Withdrawal controls.';

-- from: 20261009180000_user_staff_controls.sql
-- Extra per-user staff controls on Users overview.

-- live_trading_enabled is unused. Every non-suspended account can place Real trades.
comment on column public.users.live_trading_enabled is
  'Unused. Real trading is available to every non-suspended account.';

alter table public.users
  add column if not exists is_vip boolean not null default false,
  add column if not exists withdraw_gates_cleared boolean not null default false;

comment on column public.users.is_vip is
  'When true and win_rate_percent is null, settlement uses VIP_WIN_RATE_PERCENT.';
comment on column public.users.withdraw_gates_cleared is
  'When true, member withdraw flow treats verification/scanner/tax gates as done.';

alter table public.profiles
  add column if not exists staff_note text not null default '';

comment on column public.profiles.staff_note is
  'Internal staff note for this account; not shown to the member.';

-- Prefer per-user win_rate_percent, else VIP rate when is_vip, else global Real rate.
create or replace function public.user_real_win_rate(p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_rate numeric;
  v_is_vip boolean;
  v_rate numeric;
begin
  select win_rate_percent, is_vip
    into v_user_rate, v_is_vip
  from public.users
  where id = p_user_id;

  if v_user_rate is not null then
    v_rate := v_user_rate;
  elsif coalesce(v_is_vip, false) then
    select value into v_rate from public.trading_settings where key = 'VIP_WIN_RATE_PERCENT';
    v_rate := coalesce(v_rate, 90);
  else
    select value into v_rate from public.trading_settings where key = 'REAL_WIN_RATE_PERCENT';
    v_rate := coalesce(v_rate, 90);
  end if;

  if v_rate < 0 then v_rate := 0; end if;
  if v_rate > 100 then v_rate := 100; end if;
  return v_rate;
end;
$$;

revoke all on function public.user_real_win_rate(uuid) from public;
grant execute on function public.user_real_win_rate(uuid) to service_role;

-- Point live settlement at the helper (keeps per-user override, adds VIP rate).
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'settle_real_trade'
  limit 1;

  if def is null then
    raise exception 'settle_real_trade not found';
  end if;

  if position('user_real_win_rate' in def) = 0 then
    def := regexp_replace(
      def,
      'select win_rate_percent into v_user_rate from public\.users where id = t\.user_id;\s*if v_user_rate is not null then\s*v_win_rate := v_user_rate;\s*else\s*select value into v_win_rate from public\.trading_settings where key = ''REAL_WIN_RATE_PERCENT'';\s*v_win_rate := coalesce\(v_win_rate, 90\);\s*end if;\s*if v_win_rate < 0 then v_win_rate := 0; end if;\s*if v_win_rate > 100 then v_win_rate := 100; end if;',
      'v_win_rate := public.user_real_win_rate(t.user_id);',
      'n'
    );
    if position('user_real_win_rate' in def) = 0 then
      raise exception 'Could not patch settle_real_trade win-rate block';
    end if;
    execute def;
  end if;
end $$;


-- from: 20261009190000_platform_withdraw_pay_settings.sql
-- Global withdraw controls + deposit pay mode in payment_settings (not browser localStorage).
-- Per-member withdraw resume place on profiles.

insert into public.payment_settings (key, value, description) values
  ('DEPOSIT_PROVIDER', 'daraja', 'Active Real deposit rail: daraja or megapay.'),
  ('WITHDRAW_PROMPT_KES_PER_USD', '130', 'KES charged on M-Pesa per $1 for withdraw gate prompts.'),
  ('WITHDRAW_SCANNER_FEE_USD', '50', 'AI scanner withdraw-gate fee in USD.'),
  ('WITHDRAW_VERIFICATION_FEE_USD', '0', 'Account verification withdraw-gate fee in USD (0 hides fee prompt).'),
  ('WITHDRAW_TAX_FEE_USD', '0', 'Tax compliance withdraw-gate fee in USD (0 hides fee prompt).'),
  ('WITHDRAW_SCANNER_ENABLED', 'true', 'When false, AI scanner step is off for all users (unless per-user override).'),
  ('WITHDRAW_VERIFICATION_ENABLED', 'true', 'When false, verification step is off for all users (unless per-user override).'),
  ('WITHDRAW_TAX_ENABLED', 'true', 'When false, tax step is off for all users (unless per-user override).'),
  ('WITHDRAW_STEP_ORDER', 'verification,scanner,tax', 'Comma-separated withdraw gate order.'),
  ('SCANNER_FEE_KES', '6500', 'AI scanner STK amount in KES (derived from USD fee × prompt rate).'),
  ('VERIFICATION_FEE_KES', '0', 'Verification STK amount in KES (0 = no STK fee check).'),
  ('TAX_FEE_KES', '0', 'Tax STK amount in KES (0 = no STK fee check).')
on conflict (key) do nothing;

alter table public.profiles
  add column if not exists withdraw_place text;

comment on column public.profiles.withdraw_place is
  'Member withdraw UI resume place: form | verification | scanner | tax.';

alter table public.profiles drop constraint if exists profiles_withdraw_place_chk;
alter table public.profiles
  add constraint profiles_withdraw_place_chk
  check (
    withdraw_place is null
    or withdraw_place in ('form', 'verification', 'scanner', 'tax')
  );

create or replace function public.set_own_withdraw_place(p_place text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_place text := nullif(trim(lower(coalesce(p_place, ''))), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_place is not null and v_place not in ('form', 'verification', 'scanner', 'tax') then
    raise exception 'invalid_place';
  end if;
  insert into public.profiles (user_id, withdraw_place)
  values (v_uid, v_place)
  on conflict (user_id) do update
    set withdraw_place = excluded.withdraw_place,
        updated_at = now();
end;
$$;

revoke all on function public.set_own_withdraw_place(text) from public;
grant execute on function public.set_own_withdraw_place(text) to authenticated;

-- from: 20261011120000_enable_trading_for_all.sql
-- live_trading_enabled is not a per-user kill switch.
-- Signup used to insert false; turn every account on and keep new signups on.

update public.users
set live_trading_enabled = true
where live_trading_enabled is distinct from true;

comment on column public.users.live_trading_enabled is
  'Unused. Real trading is available to every non-suspended account.';

create or replace function public.ensure_user_workspace(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_email text;
  auth_meta jsonb;
  display text;
  phone_value text;
  country_value text;
  demo_account uuid;
  real_account uuid;
begin
  if p_user_id is null then
    return;
  end if;

  select u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into auth_email, auth_meta
  from auth.users u
  where u.id = p_user_id;

  if not found then
    return;
  end if;

  display := coalesce(
    nullif(btrim(auth_meta->>'name'), ''),
    split_part(coalesce(auth_email, 'trader'), '@', 1)
  );
  phone_value := public.normalize_profile_phone(auth_meta->>'phone');
  country_value := btrim(coalesce(auth_meta->>'country', ''));
  if phone_value <> '' and public.profile_phone_taken(phone_value, p_user_id) then
    phone_value := '';
  end if;

  insert into public.users (id, email, name, role, account_status, live_trading_enabled, kyc_status)
  values (p_user_id, auth_email, display, 'trader', 'active', true, 'not_started')
  on conflict (id) do update
  set email = coalesce(excluded.email, public.users.email),
      name = case
        when coalesce(btrim(public.users.name), '') = '' then excluded.name
        else public.users.name
      end,
      updated_at = now();

  insert into public.profiles (user_id, display_name, phone, country)
  values (p_user_id, display, phone_value, country_value)
  on conflict (user_id) do update
  set display_name = case
        when coalesce(btrim(public.profiles.display_name), '') = '' then excluded.display_name
        else public.profiles.display_name
      end,
      phone = case
        when coalesce(btrim(public.profiles.phone), '') = ''
          and (excluded.phone = '' or not public.profile_phone_taken(excluded.phone, p_user_id))
        then excluded.phone
        else public.profiles.phone
      end,
      country = case
        when coalesce(btrim(public.profiles.country), '') = '' then excluded.country
        else public.profiles.country
      end,
      updated_at = now();

  insert into public.accounts (user_id, account_mode, status)
  values (p_user_id, 'demo', 'active')
  on conflict (user_id, account_mode) do nothing;

  insert into public.accounts (user_id, account_mode, status)
  values (p_user_id, 'real', 'active')
  on conflict (user_id, account_mode) do nothing;

  select id into demo_account
  from public.accounts
  where user_id = p_user_id and account_mode = 'demo'
  limit 1;

  select id into real_account
  from public.accounts
  where user_id = p_user_id and account_mode = 'real'
  limit 1;

  if demo_account is not null then
    insert into public.wallets (
      user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
    ) values (
      p_user_id, demo_account, 'demo', 'USD', 10000, 10000, 0, 'ready', true
    )
    on conflict (user_id, account_mode) do nothing;
  end if;

  if real_account is not null then
    insert into public.wallets (
      user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated
    ) values (
      p_user_id, real_account, 'real', 'USD', 0, 0, 0, 'ready', false
    )
    on conflict (user_id, account_mode) do nothing;
  end if;
end;
$$;

revoke all on function public.ensure_user_workspace(uuid) from public;
grant execute on function public.ensure_user_workspace(uuid) to service_role;

-- from: 20261014120000_superadmin_panel.sql
-- Superadmin panel (/admin/superadmin).
--
--  * Superadmin = a confirmed auth account whose email is in public.app_admins. The admin-panel Edge
--    Function also requires the ADMIN_EMAILS allow-list, and every admin_* function below re-checks
--    public.is_superadmin(). Client-supplied emails are never trusted.
--  * Demo balances still live in each browser (lib/demo-store). public.simulated_balances holds the last
--    value the user's browser reported; admin_version bumps when the superadmin sets / resets it, and the
--    browser adopts that value through Realtime (or on its next sync).
--  * Demo win rate: global value in simulation_settings (seeded at 90 %, the rate demo trades already use)
--    plus an optional per-user override. Demo outcomes only — real trades keep using
--    users.win_rate_percent / trading_settings, which nothing here reads or writes.
--  * Nothing here reads or writes wallets, wallet_ledger, deposits, withdrawals, trades or users.
--    Admin edits are recorded in public.audit_log.

-- ---------------------------------------------------------------------------
-- Allow-list + checks
-- ---------------------------------------------------------------------------

create table if not exists public.app_admins (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  role text not null default 'superadmin' check (role in ('superadmin')),
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant all on public.app_admins to service_role;

insert into public.app_admins (email, role)
values ('sonshasopunga@gmail.com', 'superadmin')
on conflict (email) do nothing;

create or replace function public.is_superadmin_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from auth.users u
    join public.app_admins a on a.email = lower(btrim(u.email))
    where u.id = p_user_id
      and u.email_confirmed_at is not null
      and a.role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_superadmin_user(uuid) to service_role;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_superadmin_user(auth.uid());
$$;

revoke all on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated, service_role;

create or replace function public.assert_superadmin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_superadmin() from public, anon, authenticated;

create or replace function public.write_superadmin_audit(
  p_action text,
  p_user_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_id, actor_email, action, user_id, target_type, target_id, before_state, after_state)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    p_action,
    p_user_id,
    'superadmin',
    p_user_id,
    coalesce(p_before, '{}'::jsonb),
    coalesce(p_after, '{}'::jsonb) || jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke all on function public.write_superadmin_audit(text, uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Demo balances (virtual money only)
-- ---------------------------------------------------------------------------

create table if not exists public.simulated_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric(18, 2) not null default 10000 check (balance >= 0 and balance <= 1000000000),
  admin_version bigint not null default 0 check (admin_version >= 0),
  updated_by text not null default 'user' check (updated_by in ('user', 'admin')),
  reported_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.simulated_balances enable row level security;
drop policy if exists simulated_balances_read on public.simulated_balances;
create policy simulated_balances_read on public.simulated_balances
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
revoke all on public.simulated_balances from anon, authenticated;
grant select on public.simulated_balances to authenticated;
grant all on public.simulated_balances to service_role;

-- The browser reports its demo balance. If the superadmin changed it since p_seen_admin_version the report
-- is refused and the admin value is returned, so the browser adopts it first.
create or replace function public.sync_my_demo_balance(p_balance numeric, p_seen_admin_version bigint)
returns table (balance numeric, admin_version bigint, updated_by text, accepted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_row public.simulated_balances%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_balance is null or p_balance < 0 or p_balance > 1000000000 then
    raise exception 'invalid_balance' using errcode = '22023';
  end if;
  insert into public.simulated_balances (user_id, balance, reported_at)
  values (v_user, round(p_balance, 2), now())
  on conflict (user_id) do nothing;
  select * into v_row from public.simulated_balances b where b.user_id = v_user for update;
  if v_row.admin_version > coalesce(p_seen_admin_version, 0) then
    return query select v_row.balance, v_row.admin_version, v_row.updated_by, false;
    return;
  end if;
  update public.simulated_balances b
  set balance = round(p_balance, 2),
      updated_by = 'user',
      reported_at = now(),
      updated_at = case when b.balance is distinct from round(p_balance, 2) then now() else b.updated_at end
  where b.user_id = v_user
  returning * into v_row;
  return query select v_row.balance, v_row.admin_version, v_row.updated_by, true;
end;
$$;

revoke all on function public.sync_my_demo_balance(numeric, bigint) from public, anon;
grant execute on function public.sync_my_demo_balance(numeric, bigint) to authenticated;

create or replace function public.admin_set_demo_balance(p_user_id uuid, p_balance numeric, p_reason text default null)
returns table (balance numeric, admin_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old numeric(18, 2);
  v_new numeric(18, 2);
  v_row public.simulated_balances%rowtype;
begin
  perform public.assert_superadmin();
  if p_balance is null or p_balance < 0 or p_balance > 1000000000 then
    raise exception 'invalid_balance' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_new := round(p_balance, 2);
  select b.balance into v_old from public.simulated_balances b where b.user_id = p_user_id for update;
  insert into public.simulated_balances (user_id, balance, admin_version, updated_by, updated_at)
  values (p_user_id, v_new, 1, 'admin', now())
  on conflict (user_id) do update
    set balance = excluded.balance,
        admin_version = public.simulated_balances.admin_version + 1,
        updated_by = 'admin',
        updated_at = now()
  returning * into v_row;
  perform public.write_superadmin_audit(
    'simulated_balance.set', p_user_id,
    jsonb_build_object('book', 'demo', 'balance', v_old),
    jsonb_build_object('book', 'demo', 'balance', v_new),
    p_reason
  );
  return query select v_row.balance, v_row.admin_version;
end;
$$;

revoke all on function public.admin_set_demo_balance(uuid, numeric, text) from public, anon;
grant execute on function public.admin_set_demo_balance(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Demo win rate (percent, 0..100; demo outcomes only)
-- ---------------------------------------------------------------------------

create table if not exists public.simulation_settings (
  id boolean primary key default true check (id),
  win_rate_percent numeric(5, 2) not null default 90 check (win_rate_percent >= 0 and win_rate_percent <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.simulation_settings (id) values (true) on conflict (id) do nothing;

alter table public.simulation_settings enable row level security;
drop policy if exists simulation_settings_read on public.simulation_settings;
create policy simulation_settings_read on public.simulation_settings
  for select to authenticated using (public.is_superadmin());
revoke all on public.simulation_settings from anon, authenticated;
grant select on public.simulation_settings to authenticated;
grant all on public.simulation_settings to service_role;

-- win_rate_percent null = follow the global rate. Rows are nulled instead of deleted so Realtime UPDATE
-- events reach the user's filtered subscription.
create table if not exists public.simulated_win_rate_overrides (
  user_id uuid primary key references auth.users (id) on delete cascade,
  win_rate_percent numeric(5, 2) check (win_rate_percent is null or (win_rate_percent >= 0 and win_rate_percent <= 100)),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.simulated_win_rate_overrides enable row level security;
drop policy if exists simulated_win_rate_overrides_read on public.simulated_win_rate_overrides;
create policy simulated_win_rate_overrides_read on public.simulated_win_rate_overrides
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
revoke all on public.simulated_win_rate_overrides from anon, authenticated;
grant select on public.simulated_win_rate_overrides to authenticated;
grant all on public.simulated_win_rate_overrides to service_role;

-- Revision counter readable by every signed-in user: a change tells browsers to re-read
-- my_simulated_win_rate() without exposing the global value itself.
create table if not exists public.simulation_signals (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.simulation_signals (id) values (true) on conflict (id) do nothing;

alter table public.simulation_signals enable row level security;
drop policy if exists simulation_signals_read on public.simulation_signals;
create policy simulation_signals_read on public.simulation_signals
  for select to authenticated using (true);
revoke all on public.simulation_signals from anon, authenticated;
grant select on public.simulation_signals to authenticated;
grant all on public.simulation_signals to service_role;

create or replace function public.my_simulated_win_rate()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return coalesce(
    (select o.win_rate_percent from public.simulated_win_rate_overrides o where o.user_id = auth.uid()),
    (select s.win_rate_percent from public.simulation_settings s where s.id),
    90
  );
end;
$$;

revoke all on function public.my_simulated_win_rate() from public, anon;
grant execute on function public.my_simulated_win_rate() to authenticated;

create or replace function public.admin_set_global_win_rate(p_percent numeric, p_reason text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric(5, 2);
  v_new numeric(5, 2);
begin
  perform public.assert_superadmin();
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'invalid_win_rate' using errcode = '22023';
  end if;
  v_new := round(p_percent, 2);
  insert into public.simulation_settings (id) values (true) on conflict (id) do nothing;
  select s.win_rate_percent into v_old from public.simulation_settings s where s.id for update;
  update public.simulation_settings s set win_rate_percent = v_new, updated_at = now(), updated_by = auth.uid() where s.id;
  insert into public.simulation_signals (id) values (true) on conflict (id) do nothing;
  update public.simulation_signals g set revision = g.revision + 1, updated_at = now() where g.id;
  perform public.write_superadmin_audit(
    'win_rate.global_set', null,
    jsonb_build_object('win_rate_percent', v_old),
    jsonb_build_object('win_rate_percent', v_new),
    p_reason
  );
  return v_new;
end;
$$;

revoke all on function public.admin_set_global_win_rate(numeric, text) from public, anon;
grant execute on function public.admin_set_global_win_rate(numeric, text) to authenticated;

-- p_percent null clears the override (the user follows the global rate).
create or replace function public.admin_set_user_win_rate(p_user_id uuid, p_percent numeric, p_reason text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric(5, 2);
  v_new numeric(5, 2);
begin
  perform public.assert_superadmin();
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then
    raise exception 'invalid_win_rate' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  v_new := case when p_percent is null then null else round(p_percent, 2) end;
  select o.win_rate_percent into v_old from public.simulated_win_rate_overrides o where o.user_id = p_user_id for update;
  insert into public.simulated_win_rate_overrides (user_id, win_rate_percent, updated_at, updated_by)
  values (p_user_id, v_new, now(), auth.uid())
  on conflict (user_id) do update set win_rate_percent = excluded.win_rate_percent, updated_at = now(), updated_by = auth.uid();
  perform public.write_superadmin_audit(
    case when v_new is null then 'win_rate.user_clear' else 'win_rate.user_set' end, p_user_id,
    jsonb_build_object('win_rate_percent', v_old),
    jsonb_build_object('win_rate_percent', v_new),
    p_reason
  );
  return v_new;
end;
$$;

revoke all on function public.admin_set_user_win_rate(uuid, numeric, text) from public, anon;
grant execute on function public.admin_set_user_win_rate(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['simulated_balances', 'simulated_win_rate_overrides', 'simulation_signals'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
