-- Each channel's own wording, a Buffer draft to check it, and Buffer holding
-- the scheduled post (issue #101, docs/adr/0003-buffer-holds-scheduled-social-posts.md,
-- amending ADR 0001).
--
-- Until now a confirmed channel stayed in the app until its post time and was
-- then sent to Buffer with "share now". Now Schedule / Publish now hand the
-- post to Buffer as soon as the item is Live, and Buffer sends it at its time.
-- New columns on social_channel_posts, one row per item per channel as before:
--
--   lead_text       this channel's wording, written by Claude or typed. Null
--                   means the item's own lead-in (social_text, else summary,
--                   else title), as before. The app still adds the link and
--                   this network's tags after it.
--   lead_ai         Claude wrote lead_text: sent to Buffer as `aiAssisted`.
--   draft_post_id   the channel's Buffer draft ("Send draft to Buffer"), with
--   draft_text,     exactly what it held and when, so the editor can say the
--   draft_image,    post changed since. Deleted from Buffer when the real post
--   draft_at        is handed over, or replaced when sent again.
--   send_mode       the admin's choice, made with the confirmation: 'schedule'
--                   (Buffer sends at the channel's post time) or 'now'. Set
--                   and cleared together with confirmed_at.
--   handed_at       stamped just before the post goes to Buffer, only if still
--                   empty: the claim that stops a second hand-off, as posted_at
--                   was until now. buffer_post_id (existing) is the post Buffer
--                   holds.
--   due_at          when Buffer was told to send it: the daily limit counts
--                   these per channel per UK day.
--   buffer_status   Buffer's last word on the post (scheduled, sending, sent,
--                   error), read back by the social_links job.
--
-- posted_at now means Buffer reported the post sent, read back by the same
-- job. Rows posted under the old rule were handed over at that moment, so
-- handed_at and due_at are backfilled from posted_at. Rows confirmed but not
-- yet posted under the old rule become 'schedule', which is what Confirm did.
--
-- RLS unchanged: enabled with no policies (20261105000002), service role only.

alter table social_channel_posts add column if not exists lead_text text;
alter table social_channel_posts add column if not exists lead_ai boolean not null default false;
alter table social_channel_posts add column if not exists draft_post_id text;
alter table social_channel_posts add column if not exists draft_text text;
alter table social_channel_posts add column if not exists draft_image text;
alter table social_channel_posts add column if not exists draft_at timestamptz;
alter table social_channel_posts add column if not exists send_mode text;
alter table social_channel_posts add column if not exists handed_at timestamptz;
alter table social_channel_posts add column if not exists due_at timestamptz;
alter table social_channel_posts add column if not exists buffer_status text;

update social_channel_posts set send_mode = 'schedule'
  where confirmed_at is not null and send_mode is null;
update social_channel_posts set handed_at = posted_at, due_at = posted_at
  where posted_at is not null and handed_at is null;

alter table social_channel_posts drop constraint if exists social_channel_posts_send_mode;
alter table social_channel_posts add constraint social_channel_posts_send_mode
  check (send_mode in ('schedule', 'now'));

-- a choice is only ever made by confirming, and goes when the confirmation does
alter table social_channel_posts drop constraint if exists social_channel_posts_send_mode_confirmed;
alter table social_channel_posts add constraint social_channel_posts_send_mode_confirmed
  check ((send_mode is null) = (confirmed_at is null));

-- a draft is recorded whole or not at all
alter table social_channel_posts drop constraint if exists social_channel_posts_draft;
alter table social_channel_posts add constraint social_channel_posts_draft
  check ((draft_post_id is null) = (draft_at is null) and (draft_post_id is null) = (draft_text is null));

-- the daily limit counts each channel's handed-over posts by the day Buffer sends them
create index if not exists social_channel_posts_due on social_channel_posts (channel_id, due_at)
  where handed_at is not null;
