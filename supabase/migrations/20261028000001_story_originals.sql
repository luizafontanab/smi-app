-- The article a story was started from (Luiza, 28 Oct 2026). "Start story" on
-- a suggestion (/console/sources) now pre-loads the draft from the company's
-- article page and rewrites it to third person (requirements/06-content-os.md
-- "Drafting"). The pre-rewrite text is kept here so Jas can check the rewrite
-- against what the company actually wrote — the editor shows it read-only.
--
-- A table of its own, not a column on stories: public_read_published_stories
-- exposes every stories column once a story is published, and the company's
-- original wording must never be served from our API.
--
-- rewritten: whether the body on the story is the AI rewrite of this text
-- (false when the rewrite was skipped or rejected, so the draft holds the
-- original as-is).
create table if not exists story_originals (
  story_id uuid primary key references stories(id) on delete cascade,
  source_url text not null,
  body text not null,
  rewritten boolean not null,
  created_at timestamptz not null default now()
);

alter table story_originals enable row level security;
-- no policies: console-only, read and written via the service role.
