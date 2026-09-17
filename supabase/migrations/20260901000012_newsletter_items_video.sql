-- GAPS B5.3: the newsletter composer had no way to pick a video, and
-- newsletter_items' PK (issue_id, story_id) assumed every item was a story.
-- Add a nullable video_id alongside story_id, exactly one of the two set per
-- row, and replace the old composite PK with a surrogate id so either column
-- can be null.
alter table newsletter_items drop constraint newsletter_items_pkey;
alter table newsletter_items add column id uuid primary key default gen_random_uuid();
alter table newsletter_items alter column story_id drop not null;
alter table newsletter_items add column video_id uuid references videos(id) on delete cascade;
alter table newsletter_items add constraint newsletter_items_one_item check (
  (story_id is not null) <> (video_id is not null)
);

create unique index newsletter_items_issue_story_uq on newsletter_items (issue_id, story_id) where story_id is not null;
create unique index newsletter_items_issue_video_uq on newsletter_items (issue_id, video_id) where video_id is not null;
