-- A5.4: newsletter_issues had no sends/opens/clicks columns at all.
alter table newsletter_issues add column if not exists sent_count int;
alter table newsletter_issues add column if not exists opens_count int not null default 0;
alter table newsletter_issues add column if not exists clicks_count int not null default 0;
-- Resend broadcast id, so the webhook can attribute an open/click event back
-- to the issue it came from.
alter table newsletter_issues add column if not exists provider_broadcast_id text;

create index if not exists newsletter_issues_broadcast_idx
  on newsletter_issues (provider_broadcast_id) where provider_broadcast_id is not null;

-- Resend can deliver a burst of events for one broadcast; a select-then-update
-- in the webhook handler would race under concurrent deliveries.
create or replace function bump_newsletter_metric(p_broadcast_id text, p_metric text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_metric = 'opens' then
    update newsletter_issues set opens_count = opens_count + 1 where provider_broadcast_id = p_broadcast_id;
  elsif p_metric = 'clicks' then
    update newsletter_issues set clicks_count = clicks_count + 1 where provider_broadcast_id = p_broadcast_id;
  end if;
end $$;

grant execute on function bump_newsletter_metric(text, text) to service_role;
