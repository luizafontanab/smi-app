-- GAPS C6: record() silently drops every event without consent, so impressions
-- and clicks -- the numbers invoiced against advertisers -- are an undisclosed
-- undercount sampled at the site's cookie-accept rate. This table is the
-- measurement layer for that disclosure: one row per day, incremented on
-- every requestContext() call (consented or not) so the accept rate itself
-- carries no personal data -- just two counters.
create table if not exists consent_stats (
  day date primary key,
  total_requests bigint not null default 0,
  consented_requests bigint not null default 0
);

alter table consent_stats enable row level security;

-- Same shape as bump_newsletter_metric: a burst of concurrent page views
-- would race under a select-then-update, so the increment is atomic in SQL.
create or replace function bump_consent_stats(p_consented boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into consent_stats (day, total_requests, consented_requests)
  values (current_date, 1, case when p_consented then 1 else 0 end)
  on conflict (day) do update set
    total_requests = consent_stats.total_requests + 1,
    consented_requests = consent_stats.consented_requests + case when p_consented then 1 else 0 end;
end $$;

grant execute on function bump_consent_stats(boolean) to service_role;
