-- Lead-generation marks (GAPS A8.3 / A8.4, USE-CASES A29 / M14). The lead-gen
-- panels list prospects that come from the `LeadGenSource` adapter, not from
-- our database — Phase 1's adapter is a fixture, and TECH-DECISIONS #16 gates
-- the real source (n8n / Prosp) on Jas's sign-off and an SMI-owned n8n
-- instance. So the prospect itself is deliberately NOT stored here: only the
-- act of marking one, keyed by whatever stable reference the adapter gives us
-- (a LinkedIn URL, which is also how Prosp identifies a lead).
--
-- Without this table a "mark to follow up" would vanish on reload, which reads
-- as a broken feature; `settings` is a single global row and is the wrong shape
-- for per-member state.
--
-- Naming: "prospect", not "lead". `jobs.lead_alert` and
-- `notification_prefs.leads_frequency` already use "lead" to mean an
-- *engagement* lead (a profile view), and conflating the two would make
-- `jobs.ts` unreadable. The routes stay /console/leads and /dashboard/leads
-- because GAPS fixes them.
create table prospect_marks (
  id uuid primary key default gen_random_uuid(),
  prospect_ref text not null,
  -- null = an admin mark from /console/leads (A29); set = a member's own (M14).
  member_id uuid references members(id) on delete cascade,
  action text not null check (action in ('call', 'email', 'sequence', 'follow_up')),
  note text,
  created_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

-- Two partial indexes rather than one: member_id is nullable, and in Postgres a
-- NULL never conflicts, so a single unique index over (member_id, prospect_ref,
-- action) would silently let an admin mark the same prospect twice. Marking is
-- idempotent by design — the page re-renders after the action and a double
-- click must not create a second row.
create unique index prospect_marks_member_uniq
  on prospect_marks (member_id, prospect_ref, action)
  where member_id is not null;
create unique index prospect_marks_admin_uniq
  on prospect_marks (prospect_ref, action)
  where member_id is null;

create index prospect_marks_member_idx on prospect_marks (member_id, created_at desc);

alter table prospect_marks enable row level security;
-- no policies: console-managed, member area reads it via service role.
