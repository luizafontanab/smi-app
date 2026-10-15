-- Replace a story's tagged members in one transaction (review finding, 16 Oct).
--
-- lib/story-members.replaceStoryMembers did a delete then an insert as two
-- PostgREST calls. If the insert failed — a member deleted between the form
-- loading and the save, a dropped connection — the delete had already landed,
-- leaving the story with NO rows in story_members. Member profiles, timelines
-- and dashboards all read stories through `story_members!inner`, so the story
-- silently vanished from every member it featured, the primary included.
--
-- One function call is one statement, so the delete and the insert commit or
-- roll back together: a failed insert now leaves the previous set intact.
-- Duplicates in the array are collapsed (the primary key would refuse them).
--
-- security invoker: the only caller is the console's saveStory through
-- serviceDb(), which bypasses RLS anyway; nothing here needs definer rights.
-- Execute is revoked from public/anon/authenticated (Postgres grants it to
-- PUBLIC by default — see 20260901000014) and granted to service_role only,
-- since a member must never be able to retag a story through /rest/v1/rpc.

create or replace function replace_story_members(p_story_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from story_members where story_id = p_story_id;
  insert into story_members (story_id, member_id)
  select distinct p_story_id, m from unnest(coalesce(p_member_ids, '{}'::uuid[])) as m;
end $$;

revoke execute on function replace_story_members(uuid, uuid[]) from public, anon, authenticated;
grant execute on function replace_story_members(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
