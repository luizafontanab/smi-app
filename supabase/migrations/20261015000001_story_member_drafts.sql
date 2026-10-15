-- Members can save a story as a draft before submitting it (Jas feedback
-- 13/10/26, items 10/15: he wanted to see the story as it would publish before
-- sending it; Luiza chose a real member draft over preview-after-submit).
--
-- Why a flag and not just status = 'draft' + source = 'member': that pair
-- already occurs for a different thing. An admin can "Return to draft" a
-- member's published story (fix-list 47) or drag it to Draft on the board, and
-- the result is an admin's working copy — it must stay on the console board and
-- must NOT become editable by the member. Inferring "member's private draft"
-- from status + source would silently flip those rows to the member and hide
-- them from the desk. `member_draft` says it outright.
--
-- Lifecycle: set true only by the member's "Save draft" (dashboard/actions.ts
-- submitStory / editStory); cleared by their "Submit for approval", which moves
-- the row to awaiting_approval. While true, the console never lists, counts,
-- previews or moves the row (lib/story-board.ts isMemberDraft /
-- EXCLUDE_MEMBER_DRAFTS), so "Publish now" can never skip a member's approval.
-- The check keeps the flag from outliving the state it describes.
--
-- RLS: no change. A member draft is unpublished, so public_read_published_stories
-- already hides it, and member_read_own_stories already shows a member their
-- own rows. All writes go through the service role in the dashboard actions,
-- behind assertOwnsStory.

alter table stories add column if not exists member_draft boolean not null default false;

alter table stories drop constraint if exists stories_member_draft_check;
alter table stories add constraint stories_member_draft_check
  check (not member_draft or (status = 'draft' and source = 'member'));
