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
contains two of them, so one is currently **inferred**.

- [ ] **1.1 — Validate the Industries list and every member's industry.**
      The 10-item list (`ask-jas.md` § Industries) drives the industry bar,
      `/industry/*` pages, and the directory's industry filter — one per member.
      **It exists nowhere in the WordPress database.** Verified against the
      original dump: the only member taxonomies are `best-service` (69 Services
      terms) and `best-level` (4 legacy Sector terms). There is no `industry`
      taxonomy and no ACF field.
      So every member's industry is **derived from their Services tags** by
      `scripts/lib/industry-map.ts` — a documented dev assumption, not data.
      About 93% of members resolve; the rest have no industry at all.
      **Check:** is the 10-item list right, and is each member in the right one?
      **If wrong:** the industry bar, every `/industry/*` page and the directory
      filter all mis-sort members, and ~7% of members are missing from them.

- [ ] **1.2 — Validate the Services list.** The export carries 69 terms; the
      live `/find-a-member` dropdown shows 55. `ask-jas.md:85` already flags
      apparent duplicates added at different times — "Tool & Die" vs "Tool and
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

- [ ] **1.4 — Confirm "Software" appearing in two lists is intentional.** It is
      both a membership type and an industry (`ask-jas.md:101`). **Check:** is
      that deliberate, or a naming collision to resolve?

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

## 3 · Known gaps to accept or fix before launch

**Done:** 3.1 event coordinates: the export did carry them (50 of 53 events), lost in shaping and now recovered; the 3 left (wp ids 3569, 5364, 13680) have no location in WordPress either, so re-save them if they need a pin · 3.2 Services are editable in the console and by members (fix-list 52, 14 Sep); validating the vocabulary itself is 1.2.
