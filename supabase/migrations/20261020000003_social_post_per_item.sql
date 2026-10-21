-- Per-story and per-video social posting (Area 3 of the review of Jas's
-- 16 Oct story-workflow flow chart; GAPS A3.8).
--
-- The flow chart has the admin manager set the publish time AND the social
-- timing per story, with the Buffer post carrying "a lead-in from the
-- article". Until now social timing was one global delay (settings
-- `social_caps.delay_minutes`) — and six console publish paths ignored even
-- that, hard-coding 30 minutes — and the post was the title plus a link.
--
--   social_at         when the post should go out. Null = publish time plus
--                     the global delay. Never honoured earlier than the item
--                     going live; that rule lives where the push is queued
--                     (src/lib/social-push.ts socialDueAt), not in a check
--                     here, because scheduled_at is edited by a different form
--                     and published_at only exists once it is live.
--   social_text       the lead-in. Null = follow the story summary / video
--                     description. 500 is a backstop; the app enforces 200 so
--                     the per-channel budget can change without a migration.
--   social_skip       "don't post this to social media".
--   social_posted_at  stamped only after Buffer accepted the post. It is the
--                     daily cap's count (counting `done` jobs also counted
--                     pushes that were skipped or deferred over the cap), the
--                     guard against posting twice, and the editor's status.
--                     No backfill: no Buffer token has ever been set, so
--                     nothing has ever been posted.
--
-- RLS: unchanged. Stories and videos have no update policies and the member
-- insert policies were dropped in 20261016000060; every member write goes
-- through the service role with a fixed column list, so members cannot set
-- these. public_read_published_* exposes the new columns on live rows, which
-- is harmless — the lead-in is published to social anyway.

alter table stories add column if not exists social_at timestamptz;
alter table stories add column if not exists social_text text;
alter table stories add column if not exists social_skip boolean not null default false;
alter table stories add column if not exists social_posted_at timestamptz;

alter table videos add column if not exists social_at timestamptz;
alter table videos add column if not exists social_text text;
alter table videos add column if not exists social_skip boolean not null default false;
alter table videos add column if not exists social_posted_at timestamptz;

alter table stories drop constraint if exists stories_social_text_check;
alter table stories add constraint stories_social_text_check
  check (social_text is null or (btrim(social_text) <> '' and char_length(social_text) <= 500));

alter table videos drop constraint if exists videos_social_text_check;
alter table videos add constraint videos_social_text_check
  check (social_text is null or (btrim(social_text) <> '' and char_length(social_text) <= 500));
