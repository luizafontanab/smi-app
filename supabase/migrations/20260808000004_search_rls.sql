-- Full-text search (members rank first — implemented in the query, not as stored bias)
-- and row-level security.

alter table stories add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored;
create index stories_search_idx on stories using gin (search_tsv);

alter table members add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;
create index members_search_idx on members using gin (search_tsv);

-- RLS. Admin/console operations run server-side with the service role (bypasses RLS).
-- Policies below cover the anon (public site) and authenticated-member paths.

alter table members enable row level security;
alter table stories enable row level security;
alter table events enable row level security;
alter table videos enable row level security;
alter table categories enable row level security;
alter table static_pages enable row level security;
alter table profiles enable row level security;
alter table member_revisions enable row level security;
alter table notifications enable row level security;
alter table notification_prefs enable row level security;
alter table invoices enable row level security;
alter table visibility_requests enable row level security;
alter table engagement_audit enable row level security;
alter table newsletter_issues enable row level security;
alter table newsletter_items enable row level security;
alter table newsletter_signups enable row level security;
alter table inbox_messages enable row level security;
alter table analytics_events enable row level security;

-- tables that only the service role touches (no policies = no anon/auth access):
alter table adverts enable row level security;
alter table advertisers enable row level security;
alter table advert_bookings enable row level security;
alter table advert_slots enable row level security;
alter table placements enable row level security;
alter table featured_machines enable row level security;
alter table bundles enable row level security;
alter table contacts enable row level security;
alter table jobs enable row level security;
alter table redirects enable row level security;
alter table rollups_daily enable row level security;
alter table approvals enable row level security;
alter table newsletter_ads enable row level security;
alter table settings enable row level security;
alter table story_categories enable row level security;

-- public reads
create policy public_read_published_stories on stories for select
  using (status = 'published');
create policy public_read_active_members on members for select
  using (status in ('active', 'grace'));
create policy public_read_published_events on events for select
  using (status = 'published');
create policy public_read_published_videos on videos for select
  using (status = 'published');
create policy public_read_categories on categories for select using (true);
create policy public_read_static_pages on static_pages for select using (true);
create policy public_read_sent_issues on newsletter_issues for select
  using (status = 'sent');
create policy public_read_issue_items on newsletter_items for select using (true);
create policy public_read_story_categories on story_categories for select using (true);

-- public writes (forms)
create policy public_insert_signup on newsletter_signups for insert with check (true);
create policy public_insert_inbox on inbox_messages for insert with check (true);

-- member self-service
create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select member_id from profiles where user_id = auth.uid()
$$;

create policy member_read_own_profile on profiles for select
  using (user_id = auth.uid());
create policy member_read_own_stories on stories for select
  using (member_id = current_member_id());
create policy member_insert_story on stories for insert
  with check (member_id = current_member_id() and source = 'member'
              and status = 'awaiting_approval');
create policy member_insert_event on events for insert
  with check (member_id = current_member_id() and status = 'awaiting_approval');
create policy member_read_own_events on events for select
  using (member_id = current_member_id());
create policy member_insert_revision on member_revisions for insert
  with check (member_id = current_member_id());
create policy member_read_own_revisions on member_revisions for select
  using (member_id = current_member_id());
create policy member_read_own_notifications on notifications for select
  using (member_id = current_member_id());
create policy member_rw_own_prefs on notification_prefs for all
  using (member_id = current_member_id())
  with check (member_id = current_member_id());
create policy member_read_own_invoices on invoices for select
  using (member_id = current_member_id());
create policy member_insert_visibility_request on visibility_requests for insert
  with check (member_id = current_member_id());
create policy member_read_own_requests on visibility_requests for select
  using (member_id = current_member_id());
create policy member_read_own_audit on engagement_audit for select
  using (member_id = current_member_id());
