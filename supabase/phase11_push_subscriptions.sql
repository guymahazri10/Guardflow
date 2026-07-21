-- GuardFlow Phase 11 — Web Push subscriptions + notification dedup ledger
--
-- Backs the position-change push feature: each device that opts in via the
-- NotificationBell stores one row here; send-position-push (a scheduled
-- Edge Function) reads these to know where to deliver the alert.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'Web Push subscriptions for position-change alerts. Endpoint is unique per device/browser.';

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- Dedup log so the scheduled function never sends the same position-change
-- alert twice for the same user. Only the service role touches this table.
create table public.push_notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  notify_key text not null,
  notified_at timestamptz not null default now(),
  primary key (user_id, notify_key)
);

comment on table public.push_notification_log is 'Dedup ledger for send-position-push: one row per (user, transition) ever notified.';

alter table public.push_notification_log enable row level security;
grant all on public.push_notification_log to service_role;
