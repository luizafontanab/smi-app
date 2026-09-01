-- A5.1: log what readers search for, instead of dropping it on the floor.
-- No FK to anything — a search query outlives whatever it did or didn't match.
create table search_queries (
  id bigint generated always as identity primary key,
  query text not null,
  results_count int not null default 0,
  session_hash text,
  occurred_at timestamptz not null default now()
);

create index search_queries_occurred_idx on search_queries (occurred_at desc);

-- Service-role only, same posture as analytics_events: no policies means no
-- anon/auth access, only the service-role writer and console readers.
alter table search_queries enable row level security;
