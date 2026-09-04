-- Collapsible content pages (fix-list 7/13): when set, /pages/[slug] renders
-- each h2/h3-headed section of the body as a <details>/<summary> block instead
-- of one flat article. Off by default — only pages that read as a list of
-- discrete entries (Policies, FAQ) opt in via the console editor.
alter table static_pages
  add column collapsible boolean not null default false;
