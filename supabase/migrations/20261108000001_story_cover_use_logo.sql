-- The member's logo as a story's picture (Jas 28/10: "when its a member story
-- should we consider using the members logo from their membership page as a
-- final resort option").
--
-- Two rules, both applied at render time by lib/story-image:
--   * a member story with no cover shows its member's logo instead — no column
--     needed for that;
--   * this flag lets an admin show the logo even when there IS a cover, for a
--     poor photo ("admin can override", Luiza 8 Nov). The cover is kept, so
--     unticking it brings the photo back.
-- The flag does nothing on a story with no member, or whose member has no logo.
--
-- Only the console editor writes it; member saves never do. Read with the
-- story row, so the existing stories policies cover it; no RLS change.
--
-- Closes "Jas feedback: open items" #6.

alter table stories add column if not exists cover_use_logo boolean not null default false;
