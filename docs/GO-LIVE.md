# Go-live — what Jas has to validate on the day

Things that need **client input or validation at launch**, when the real data is
in front of him. Distinct from the other two lists:

- [`HUMAN-TODO.md`](HUMAN-TODO.md) — things **you** do as we go: accounts, DNS,
  hosted-dashboard settings, prod migrations.
- [`ask-jas.md`](ask-jas.md) — open questions we're waiting on **during** the
  build.
- **This file** — checks that can only really be made against the live data on
  go-live day, by the person who knows the business.

Each item says what to check, and what's wrong if it isn't checked.

**Finished items are collapsed** into each section's **Done:** line, with the
full notes in git: `git show 97975e6:docs/GO-LIVE.md`. Only `fix-list.md` keeps
ticked `[x]` items.

---

## 1 · Member taxonomies — the highest-risk item

The live site has three separate member lists and the WordPress export only
contains two of them. The third, Industries, now comes from Jas (12 Oct 2026):
his list, and his mapping from the other two onto it.

- [ ] **1.1 — Review what Jas's industry mapping left without an industry.**
      The ten industries are now Jas's own (his spreadsheet, 12 Oct 2026), and a
      member can be in several, with one primary. Assignments come from his
      mapping of every Service and news category to an industry
      (`scripts/lib/industry-map.ts`), applied by `pnpm industries:backfill`
      (HUMAN-TODO 26.1). Against the full export that leaves **8 of 123 members,
      ~1,100 stories tagged only "Industry News", and all 53 events** with no
      industry — events carry no member in the export.
      **Check:** run `pnpm industries:backfill:prod -- --dry-run --report` and send
      Jas the two lists; he asked to be told ("I'll let you know later if any
      ends up without an industry"). Spot-check a few members' primary industry
      while you're there.
      **If wrong:** those members and stories are missing from the industry bar,
      every `/industry/*` page and the directory's industry filter.

- [ ] **1.2 — Validate the Services list.** The export carries 69 terms; the
      live `/find-a-member` dropdown shows 55. The old ask-jas Services section
      (`git show 2c0a3cc^:docs/ask-jas.md`) flagged apparent duplicates added at
      different times — "Tool & Die" vs "Tool and
      Die", "Tube Bending and Pipe Fabrication" vs "Tube Bending/ Manipulation
      Services", two Additive Manufacturing variants, two Coil Processing
      variants. **Check:** which of each pair is current, and should the list be
      consolidated? **If wrong:** the Services filter shows duplicate options
      that split the same members across two entries.

- [ ] **1.3 — Validate membership types against the legacy Sector field.**
      The app carries the 5-item list (Equipment Supplier, Service Provider, IT
      Services, Software, Training and Education); WordPress had a 4-option
      "Sector" (Trade Association/Events, Service Provider, Equipment Supplier,
      Subcontractor/OEM). **Only two map.** Members whose sector was
      Subcontractor/OEM or Trade Association/Events currently carry **no**
      membership type. **Check:** is the 5-item list correct, and where do those
      members belong? **If wrong:** those members are invisible to the
      membership-type filter.

- [ ] **1.4 — Confirm the Software / IT overlap between lists is intentional.**
      Jas's industry "Software & IT Services" now sits beside two membership
      types, "Software" and "IT Services" (the old ask-jas note:
      `git show 2c0a3cc^:docs/ask-jas.md`). **Check:** is that deliberate, or a
      naming collision to resolve?

## 2 · Imported content spot-check

- [ ] **2.1 — Spot-check member pages against the live site.** Logos and hero
      images rendering at the right crop, descriptions that came through the
      sanitiser intact (legacy rows held hand-typed HTML), addresses and contact
      details correct. **Check a handful across different industries**, not just
      the first page of the directory.
- [ ] **2.2 — Confirm the featured machine.** Currently seeded with the real S1
      Laser Punching Machine (Salvagnini UK & Ireland), copied from the live
      site. **Check:** is that still the one Jas wants featured at launch?
- [ ] **2.3 — Confirm which members are live.** The import carries the WP
      `active` flag; anyone lapsed, renamed or merged since the export needs
      correcting before the directory goes public.
- [ ] **2.4 — Final Mailchimp export at cutover** (gap review area 7, GAPS
      B5.13). The WordPress signup form keeps adding people to the agency's
      Mailchimp list, and people keep unsubscribing there, until the day the new
      site goes live. On that day, after the form has switched over and before
      the first newsletter from the new system, get a fresh full export
      (subscribed, unsubscribed and cleaned) and run
      `pnpm contacts:import-mailchimp:prod <dir>` as a dry run, then `--apply`.
      **Check:** the dry run's "now unsubscribed" and "new contacts" counts are
      small and make sense to Jas against what he knows of the last month.
      **If wrong:** don't apply. A big "now unsubscribed" figure means the
      earlier import (HUMAN-TODO 3.9) never ran.

## 3 · Known gaps to accept or fix before launch

**Done:** 3.1 event coordinates: the export did carry them (50 of 53 events), lost in shaping and now recovered; the 3 left (wp ids 3569, 5364, 13680) have no location in WordPress either, so re-save them if they need a pin · 3.2 Services are editable in the console and by members (fix-list 52, 14 Sep); validating the vocabulary itself is 1.2.
