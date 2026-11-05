-- Social posts go out only after an admin confirms each channel (issue #43,
-- docs/adr/0001-social-posts-need-per-channel-confirmation.md).
--
-- Until now a story or video going Live posted to every Buffer channel 30
-- minutes later unless "Don't post" (social_skip) was ticked, and nobody saw
-- the final per-channel text. Now each channel needs its own confirmation,
-- so the state that used to sit on the item moves to one row per item per
-- channel:
--
--   channel_id        a Buffer channel id from settings `social_channels`. A
--                     channel with no row is unconfirmed, which is how a newly
--                     connected channel starts.
--   skip              "Don't post" for this channel only. The item-level
--                     social_skip column stays as "Don't post" for all of them.
--   confirmed_*       the snapshot: exactly what the channel would receive
--                     (text and image path) when an admin confirmed it, who and
--                     when. Just before posting, the post is built again and
--                     compared; a difference clears these and the channel
--                     waits for confirmation again (src/lib/social-confirm.ts).
--   posted_at         stamped only after Buffer accepted this channel's post.
--                     It is the daily cap's count (now per channel) and the
--                     guard against posting twice: a retry skips any channel
--                     already stamped, which replaces the job payload's
--                     done_channel_ids.
--
-- Superseded, not dropped: stories/videos.social_posted_at is no longer
-- written or read. It has never held a value (no Buffer token has ever been
-- set), and dropping it here would break code on other branches that still
-- selects it against the shared local database. A later migration can drop it.
--
-- Backfill, decided by Luiza on 5 Nov 2026: every story and video already
-- Live is marked "Don't post" for the whole item. Under the old rule saving an
-- old item never posted it, so this keeps that behaviour; without it, once
-- channels are connected, hundreds of imported stories would each be listed in
-- Needs You Today as waiting for confirmation. Unticking it in the editor and
-- confirming shares an old story on purpose.
--
-- RLS: enabled with no policies. Console-managed; read and written through the
-- service role only (the console editor, the social_push job, the digest).

create table if not exists social_channel_posts (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  channel_id text not null check (btrim(channel_id) <> ''),
  skip boolean not null default false,
  confirmed_text text,
  confirmed_image text,
  confirmed_by uuid references profiles(user_id) on delete set null,
  confirmed_at timestamptz,
  posted_at timestamptz,
  buffer_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_channel_posts_one_item check (num_nonnulls(story_id, video_id) = 1),
  -- a confirmation always carries the text it confirmed
  constraint social_channel_posts_snapshot check ((confirmed_at is null) = (confirmed_text is null)),
  constraint social_channel_posts_story_channel unique (story_id, channel_id),
  constraint social_channel_posts_video_channel unique (video_id, channel_id)
);

-- the daily cap counts each channel's posts since London midnight
create index if not exists social_channel_posts_posted on social_channel_posts (channel_id, posted_at)
  where posted_at is not null;

alter table social_channel_posts enable row level security;
-- no policies: console-managed, read and written via the service role.

update stories set social_skip = true where status = 'published' and not social_skip;
update videos set social_skip = true where status = 'published' and not social_skip;
