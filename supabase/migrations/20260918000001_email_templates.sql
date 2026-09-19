-- Admin-editable email templates (fix-list 63). Every email the site sends —
-- the 29 member notification kinds, the alerts and daily digest that go to Jas,
-- the shell wrapping all of them, and the newsletter wrapper — had its copy
-- hardcoded in `src/lib/email/templates.ts`, so changing one word was a code
-- change and a deploy.
--
-- This is the "override" half of a default-plus-override pair, the same shape
-- as `page_layouts` + `src/lib/blocks/defaults.ts`. The shipped copy stays in
-- code (`src/lib/email/defaults.ts`) and a row here holds only what an admin has
-- actually changed.
--
-- Hence: **every copy column is nullable, and a row is a PARTIAL override.**
-- That is the whole design. With NOT NULL columns the console would have to
-- write a full row on every save, so the moment Jas edited one subject line that
-- kind's body would freeze at whatever shipped that day and no later copy fix in
-- code could ever reach it again. Nullable columns mean "Reset to default" is a
-- DELETE, and a per-field reset is just setting that column back to null.
--
-- `label` is the in-app notification feed's short text, edited on the same row
-- as its email so the two surfaces cannot drift (GAPS A4.10). It is meaningful
-- only for family = 'member'; nothing else has a feed entry.
--
-- `kind` is a NotificationKind, one of the admin kinds, or a reserved wrapper
-- key. The wrapper keys lead with an underscore so they can never collide with
-- a real kind.
create table email_templates (
  kind text primary key,
  family text not null check (family in ('member', 'admin', 'shell', 'newsletter')),
  subject text,
  label text,
  body_html text,
  body_text text,
  cta_label text,
  -- Stamped by hand in the console action: this repo has no triggers anywhere.
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(user_id) on delete set null
);

create index email_templates_family_idx on email_templates (family, kind);

alter table email_templates enable row level security;
-- no policies: console-managed, member area reads it via service role.

notify pgrst, 'reload schema';
