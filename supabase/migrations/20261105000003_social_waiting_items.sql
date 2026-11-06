-- "Waiting for confirmation" worked out in the database (issue #43, code
-- review finding 3 on 20261105000002).
--
-- Needs You Today and the morning digest list Live stories and videos whose
-- post time has passed while a connected Buffer channel still has no
-- confirmation, "Don't post" or post (src/lib/social-post.ts socialWaiting).
-- That used to load every Live item not marked "Don't post" and then send all
-- their ids back in one `.in()` filter. Items stay in that set for good —
-- including ones already posted on every channel — so the request would one
-- day outgrow the URL limit or PostgREST's 1000-row cap, and either way
-- waiting items would quietly drop out of the list. This function returns only
-- the items that actually have a channel waiting, so the result stays as
-- small as the list on screen.
--
-- A channel counts as settled when its row is marked skip, posted, or
-- confirmed; a connected channel with no row at all is waiting. The post time
-- is the item's own social_at, else publication plus the global delay — the
-- same rule as postTimeOf in src/lib/social-confirm.ts.
--
-- Called only through the service role (the console and the admin_digest
-- job), so execute is revoked from PUBLIC — see
-- 20260816000002_revoke_maintenance_fns_from_public.sql for why PUBLIC and
-- not just anon/authenticated. No new table, so no RLS change.

create or replace function social_waiting_items(p_channel_ids text[], p_delay_minutes integer, p_now timestamptz default now())
returns table (kind text, id uuid, title text, waiting integer)
language sql
stable
set search_path = public
as $$
  with items as (
    select 'story'::text as kind, s.id, s.title, s.published_at
    from stories s
    where s.status = 'published' and not s.social_skip and s.published_at is not null
      and coalesce(s.social_at, s.published_at + make_interval(mins => p_delay_minutes)) <= p_now
    union all
    select 'video'::text, v.id, v.title, v.published_at
    from videos v
    where v.status = 'published' and not v.social_skip and v.published_at is not null
      and coalesce(v.social_at, v.published_at + make_interval(mins => p_delay_minutes)) <= p_now
  ),
  counted as (
    select i.kind, i.id, i.title, i.published_at,
      (
        select count(*)::integer
        from unnest(p_channel_ids) as c(channel_id)
        where not exists (
          select 1 from social_channel_posts p
          where ((i.kind = 'story' and p.story_id = i.id) or (i.kind = 'video' and p.video_id = i.id))
            and p.channel_id = c.channel_id
            and (p.skip or p.posted_at is not null or p.confirmed_at is not null)
        )
      ) as waiting
    from items i
  )
  select kind, id, title, waiting
  from counted
  where waiting > 0
  order by kind, published_at, id;
$$;

revoke execute on function social_waiting_items(text[], integer, timestamptz) from public;
grant execute on function social_waiting_items(text[], integer, timestamptz) to service_role;
