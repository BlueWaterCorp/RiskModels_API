-- Activation funnel telemetry for the .net "Run a Snapshot" loop.
-- Spec: docs/ACTIVATION_LOOP_SPEC.md
-- North-star KPI: # of snapshots generated; this table captures the pre-snapshot funnel.

create table public.activation_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  user_id     uuid null references auth.users(id) on delete set null,
  event_name  text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activation_events_event_created_idx
  on public.activation_events (event_name, created_at desc);

create index activation_events_session_idx
  on public.activation_events (session_id, created_at desc);

alter table public.activation_events enable row level security;

create policy "anon and authenticated can insert activation events"
  on public.activation_events
  for insert
  to anon, authenticated
  with check (true);

-- No SELECT policy: analytics dashboards read via service role.
