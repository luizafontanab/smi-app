-- Links from a story to SMI's OWN posts of it on LinkedIn, Facebook and X
-- (Jas feedback 13/10/26, item 8).
--
-- Jas: people don't really use "share" buttons on websites; link to the post
-- on our social pages instead — it grows our clicks, and readers comment there
-- with more confidence. Buffer (lib/adapters/social.ts) only returns its own
-- post id when it queues a post, never the live LinkedIn/Facebook/X URL, so
-- the URL is pasted by the editor once the post has gone out. Decided by
-- Luiza 14 Oct: per-story fields, and any channel left empty links to SMI's
-- page on that network instead (lib/social.ts SMI_SOCIAL_URLS) — the story
-- page never shows a dead button.
--
-- One jsonb object keyed like members.social rather than three text columns:
-- one write in saveStory, and adding a channel later is a CHECK change, not a
-- new column. The CHECK is the database's half of the validation in
-- lib/social.ts storyPostUrl: only the three keys, each an https URL on that
-- network's own host (any subdomain). A javascript: or look-alike-host value
-- can't be stored even by a direct write.
--
-- RLS: no change. The column rides public_read_published_stories — these are
-- public post URLs, published on purpose — and writes go through the service
-- role in the console's saveStory only. Member actions never read these fields.

alter table stories add column if not exists social_posts jsonb not null default '{}'::jsonb;

alter table stories drop constraint if exists stories_social_posts_check;
alter table stories add constraint stories_social_posts_check check (
  jsonb_typeof(social_posts) = 'object'
  and (social_posts - array['linkedin', 'facebook', 'x']) = '{}'::jsonb
  and (not social_posts ? 'linkedin'
       or social_posts ->> 'linkedin' ~* '^https://([a-z0-9-]+\.)*linkedin\.com(/|$)')
  and (not social_posts ? 'facebook'
       or social_posts ->> 'facebook' ~* '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com)(/|$)')
  and (not social_posts ? 'x'
       or social_posts ->> 'x' ~* '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)(/|$)')
);
