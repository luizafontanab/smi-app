-- A console notification when a live member submits a company-page edit
-- (GAPS A1.12, fix-list 71).
--
-- 20260923000001 gave every member submission — story, video, event,
-- equipment, advert booking, artwork swap — an inbox notification that links
-- to the item, except one: an edit to a page that is already live. A draft's
-- first submit is `page_submitted`; a live page's edit becomes a
-- member_revisions row and raised nothing, because the kind check had no value
-- for it. It still surfaced under "Quick approvals" and on the member's console
-- record, so nothing was lost — this closes the consistency gap.
--
-- Same drop-and-recreate as 20260923000001 (a check constraint cannot be
-- altered in place), with the list repeated verbatim plus the one new kind.
-- Idempotent: running it twice leaves the same constraint.

alter table inbox_messages drop constraint if exists inbox_messages_kind_check;
alter table inbox_messages add constraint inbox_messages_kind_check
  check (kind in (
    -- messages: a person wrote this
    'contact', 'advertising', 'membership',
    -- notifications: something happened
    'signup_started', 'payment_taken', 'page_submitted', 'payment_failed',
    'subscription_ended', 'comp_expired', 'membership_lapsed', 'advert_ending',
    'story_submitted', 'video_submitted', 'event_submitted', 'machine_submitted',
    'advert_submitted', 'artwork_submitted',
    'page_edit_submitted'
  ));
