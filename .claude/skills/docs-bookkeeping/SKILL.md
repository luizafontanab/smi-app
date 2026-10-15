---
name: docs-bookkeeping
description: Route a finished change to the right doc in docs/ and close it in that doc's format (collapse into Closed/Done lines; only fix-list ticks) — GAPS, HUMAN-TODO, GO-LIVE, ask-jas, fix-list. Use when work lands, when something turns out to be blocked, or when a new question for the client appears.
---

# Keeping the docs honest

Five lists, five purposes, five item formats. They only stay useful while each one holds
exactly its own kind of thing — a blocked item filed in `GAPS.md` instead of
`HUMAN-TODO.md` reads as unfinished work rather than as work waiting on a person.

Every substantive commit here edits at least one of these, and some commits do nothing else
(`fa4a848`, `d93014e` — "Tick HUMAN-TODO 9.1 and 10.1 — prod migrations applied").

## Close items as you go, not at the end

`AGENTS.md` asks for items to be ticked off **as they land** (collapsed, in every list but
fix-list — see below). Do it that way, per item, not as a
documentation sweep once the whole pass is finished:

- **Finish an item → update its doc entry before starting the next one.** On a multi-item
  pass this is the only reliable record of which items are actually done; a batch at the end
  gets written from memory, and memory is where the `**Fixed:**` detail goes vague.
- **Write what you actually built, while you still remember the trade-off.** The paragraph is
  worth more than the checkbox, and it's unrecoverable a day later.
- **Discover a new gap mid-pass? Write it down immediately**, in the right doc, even though
  you're mid-way through something else. Items found en route get their own entry (or a
  `**Found and fixed en route:**` note on the item you were working on).
- **Say so in the working notes as items land**, so progress is visible without waiting for
  the final summary.

Keep the trailing state marker current too: `*(Working tree, uncommitted.)*` while it's
uncommitted, swapped for the commit SHA once it lands.

## Which doc

Ask what kind of thing you're holding, not which area of the app it touches:

| It is… | Goes in | |
|---|---|---|
| A Phase-1 gap against `../requirements/USE-CASES.md`, now closed | `docs/GAPS.md` | numbered A/B/C |
| Code-complete but **inert** — needs a key, account, DNS, dashboard setting or approval | `docs/HUMAN-TODO.md` | numbered §N.N |
| Only checkable **on launch day, against real data, by Jas** | `docs/GO-LIVE.md` | numbered §N.N |
| An open question blocking the build **now** | `docs/ask-jas.md` | prose |
| An item from the client's punch-list | `docs/fix-list.md` | client's numbering |

Two items frequently come out of one change: a fix-list item whose production half needs a
migration pushed gets ticked in `fix-list.md` **and** added to `HUMAN-TODO.md`. That pairing
is the norm, not a special case.

## Only fix-list.md keeps ticks

`GAPS.md`, `HUMAN-TODO.md` and `GO-LIVE.md` **never contain `[x]`** (since 5 Oct 2026 — each
file's preamble says so). A finished item is *collapsed*: its open entry is removed and its ID
moves into the one-line **Closed:** (GAPS) or **Done:** (HUMAN-TODO, GO-LIVE) index at the end
of its section, with the essentials in a few words. The full write-up lives in git history —
the preambles name the commit to `git show` for older notes. Only `fix-list.md` ticks in place.

## GAPS.md — never renumber, never delete

Numbers are referenced from commit messages, migrations and the other docs, so they're
permanent and never reused. When an item closes, remove its open entry and add it to the
section's **Closed:** line, saying in a clause what was actually built *and what it cost* —
the trade-off is the part worth keeping:

```markdown
**Closed:** A1.1 console cover upload · A1.3 category CRUD: `/console/categories` list+form;
`kind` locked after creation (changing it under a referenced category would be a broken edit)
```

- Open items keep the `- [ ] **ID — Title.** …` form; `→` always precedes the `path:line`
  pointer(s), on the item line.
- A partly-closed item stays open with the residual named (`**A1.5 (residual) — …**`), and
  the closed half goes on the Closed line.
- Other labels are in use on open items where "closed" would be a lie: `**Deliberately held:**`,
  `**Deferred (31 Aug 2026)** —`, `**Correction:**`, `**Hardened 1 Sep:**`. Pick the honest one.
- To retract a claim, **strike it through in place** (`~~…~~`) and write the correction
  after it. Don't delete — the retraction is the record.

## HUMAN-TODO.md — add to it, don't start a second list

That instruction is in its own preamble. Everything here is written, merged and inert.

```markdown
- [ ] **10.4 — Imperative instruction.** Why it's needed, what stays broken until it's done,
      and the exact env vars, URLs or commands.
```

- Sections are `## N · Title — what it blocks`, appended in order, always **before**
  `## Not in this list`. A dated work-pass gets its own section (`## 10 · Fix-list pass
  (3 Sep) — production follow-through`).
- Completed items are collapsed, not ticked: remove the entry and add its ID to the section's
  **Done:** line with a dated clause — `9.2 pushed 6 Sep with 9.1 (one \`pnpm db:push:prod\`)`.
- File it the moment the work goes inert — that's the point at which you know *why* it's
  blocked, which is most of the entry.

## GO-LIVE.md — what Jas checks on the day

Only for things that can't be verified without real data in front of the person who knows
the business. Each item carries both halves:

```markdown
- [ ] **1.1 — Validate the Industries list and every member's industry.**
      **Check:** … **If wrong:** …
```

Checked items collapse into the section's **Done:** line, as in HUMAN-TODO.

## ask-jas.md — open questions, no checkboxes

Answers arrive by editing the file, so there's nothing to tick. Two zones: a short numbered
list under `## Branding & content`, and `## Data validation` with one `###` per taxonomy.
New findings go in as **datestamped italic notes** under the relevant list, added when you
hit the question rather than saved up:

```markdown
*Note (9 Sep): this list has **no source in the WordPress data** — it's inferred by
`scripts/lib/industry-map.ts`. See GO-LIVE.md §1.1.*
```

## fix-list.md — the client's words, and pruning

The one list where **completed items are deleted** once they've been reported back. That's
why the numbering is sparse (1, 24, 26, 29, 38 today) — the gaps are items already reported.
Numbers are never reused.

- Preserve the client's wording verbatim. Don't tidy the grammar.
- Mark done as `N. [x] <their words> — <what was actually done>`, annotation after an em dash.
- If the answer is "it isn't broken", say so and say what you checked — item 29 is the model,
  and it ends by inviting correction rather than closing the question.
- **Untriaged asks arrive as unnumbered `-` bullets at the bottom.** They get a number only
  when a pass picks them up. Leave them alone otherwise.

## Commit subjects

`Fix-list pass (items 24-35): …` · `Fix-list 34: …` · `Tick HUMAN-TODO 9.1 and 10.1 — prod
migrations applied`. Bodies are one bullet per area. Doc ticks are a commit-worthy unit on
their own.
