-- A member's JWT no longer reads the desk's unpublished work about them
-- (review finding, 16 Oct — "the desk's work stays the desk's").
--
-- member_read_own_stories (20260808000004_search_rls.sql) was
-- `using (member_id = current_member_id())`: every story that names the member
-- as its subject, whoever wrote it and whatever its state. The app never reads
-- `stories` with a member's session — every dashboard read goes through
-- serviceDb() and its own ownership checks — but the publishable key is public
-- and a member's access token is theirs to use, so /rest/v1/stories with both
-- handed a member the desk's drafts, scheduled copy and in-review stories about
-- them, body included. The member area had meanwhile been built on the
-- opposite assumption: an admin's story about a member is the desk's until it
-- publishes (lib/story-preview ownerMayPreview, lib/member-story
-- memberCanEditStory, lib/story-board isMemberDraft).
--
-- The policy now says what the member area says. A member reads, of the rows
-- naming them as subject:
--   · their own unsubmitted draft (member_draft — implies source = 'member',
--     stories_member_draft_check);
--   · what they wrote and handed over, while it waits on, or came back from,
--     a decision — source 'member' in awaiting_approval, rejected or withdrawn;
--   · anything published (already public through
--     public_read_published_stories; repeated so this policy reads whole).
-- Not: an admin's draft about them, anything scheduled (approved — the desk's
-- copy now, possibly edited), or an admin's "Return to draft" of their story
-- (status draft without member_draft, the desk's working copy — see
-- 20261015000001).
--
-- Nothing in the app depends on the wider policy: the only session-client
-- reads (lib/auth.ts, the reset and login pages) touch `profiles` and auth,
-- never `stories`. member_insert_story is unchanged.

drop policy if exists member_read_own_stories on stories;
create policy member_read_own_stories on stories for select
  using (
    member_id = current_member_id()
    and (
      member_draft
      or status = 'published'
      or (source = 'member' and status in ('awaiting_approval', 'rejected', 'withdrawn'))
    )
  );
