-- V13 / gap 9: multi-step join funnel — account → pay → draft page → Jas activates.
-- Payment precedes approval (decided 9 Aug 2026); activation stays the final gate.

alter table members
  add column paid_at timestamptz,
  add column comped_until date,
  add column draft_submitted_at timestamptz,
  add column contact_email text;

alter table inbox_messages drop constraint if exists inbox_messages_kind_check;
alter table inbox_messages add constraint inbox_messages_kind_check
  check (kind in ('contact', 'advertising', 'membership'));

alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals add constraint approvals_kind_check
  check (kind in ('story', 'event', 'member_revision', 'member_activation'));
