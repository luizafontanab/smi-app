# Visual regression

Screenshots every public page, the member area and the operator console, and
compares each one to a committed baseline. When something moved, it tells you
**which regions of which pages** changed and what element sits under each one.

It runs **only when you run it**. It is not part of `pnpm check`, not part of
`pnpm test:e2e`, and it does not run in CI.

It **never updates a baseline on its own**. A missing baseline is a hard failure,
not a silent first write. Promoting a capture to a baseline is a separate command
you type on purpose.

## Running it

Supabase must be up and seeded (check it as the `run-smi-app` skill shows).
The dev server on 3100 can stay running — this builds into its own directory and
serves on its own port.

```sh
pnpm visual                      # build, serve, capture all ~86 routes, compare
pnpm visual --no-build           # reuse the last visual build (much faster)
pnpm visual --only 'console_*'   # just one area
pnpm visual --only home          # one route, by id
pnpm visual --role member        # everything behind the member login
pnpm visual:report               # open the last report
```

`pnpm visual` takes a few minutes: a production build, two logins, then ~86
full-page captures at concurrency 2.

### Exit codes

| code | meaning |
|---|---|
| 0 | every route matched its baseline |
| 1 | at least one route changed — go and look |
| 2 | a baseline was missing, or a route errored. **The run is not a valid comparison.** |
| 3 | setup failed: build, server, env, or login |

2 outranks 1 deliberately. A missing baseline and a changed page need completely
different responses, so they must never be reported as the same thing.

## Accepting a new baseline

Look at the report first. Then name what you are accepting:

```sh
pnpm visual:accept home news member_slug   # these three, and nothing else
pnpm visual:accept --changed               # every route that changed
pnpm visual:accept --new                   # every route with no baseline yet
pnpm visual:accept --all                   # both, after typing 'accept'
pnpm visual:accept --prune-orphans         # drop baselines whose route is gone
```

Accepting per route is the normal case, and both the terminal summary and the
HTML report print the exact line for each changed route so you can copy it.

`--new` is a separate flag from `--changed` on purpose: "I added a page" and "I
changed a page" are different intents and should not share a keystroke.

Accept refuses to run if the capture on disk no longer hashes to what the report
recorded — you cannot accept a stale run, or one whose PNG was edited. It writes
the files and reminds you to `git add tests/visual/baseline`; it never commits.

## What you will see that is NOT a regression

There is deliberately **no masking, no threshold and no anti-aliasing
tolerance**. Any changed pixel is reported, and you decide what matters. That
means some regions legitimately change on their own and will show up:

| Where | Why |
|---|---|
| `/member`, `/` member grid | `memberDirectory()` reshuffles daily off a UTC date seed (`src/lib/queries.ts`) |
| `/dashboard` | "your last story was N months ago" is computed from the clock |
| `/dashboard/stats`, `/console/analytics` | rolling 30-day and 12-month windows |
| `/event`, `/console`, `/console/{stories,videos,events,newsletter}` | the calendar's "today" cell, and the visible month |
| any public page | the advert takeover is date-bounded and turns itself on and off |
| map pages | Leaflet tiles are blocked (see below), so the pane renders empty |
| form-heavy pages | see below — a few pixels of border anti-aliasing flap between runs |

These move with the calendar, not with your code. Recognise them and move on.

### Sub-pixel flap on form borders

Measured, not guessed: on pages with several form controls (`/login`,
`/reset/new`, `/console/*/new`, `/dashboard/billing`) roughly **1–20 pixels**
flap between two runs of unchanged code — always slivers 1–2px wide on an input
or button border, i.e. Chromium rasterising a border at a fractional device
pixel slightly differently. It is around 0.001% of the page.

These are reported, not hidden. That is the deliberate trade: this suite has no
threshold, so you see everything and decide. A change described as
`10px scattered across within form.max-w-sm` and worth 0.0009% is that; a real
regression looks nothing like it — it names a specific element and runs to whole
percentages.

If it ever becomes annoying enough to be worth fixing rather than reading, the
thing to investigate is why those borders land on fractional pixels, **not** a
tolerance threshold — a threshold would hide real one-line regressions too.

The captures block every non-localhost request, so map tiles never load and no
run touches a third party.

## Things that will invalidate every baseline at once

- **Reseeding the database.** Baselines are photographs of specific content.
  After a reseed: run, look, `pnpm visual:accept --changed`.
- **A Playwright or Chromium upgrade.** Font rasterisation shifts. The report
  prints a fingerprint banner when the baseline was captured on a different
  setup; nothing halts, but expect a noisy run and a full re-baseline.
- **Running on a different machine or OS.** Baselines are macOS-local. This is
  why the suite refuses to run in CI at all.

## How determinism is achieved

Not by ignoring things — by removing the randomness before the shutter opens.
Three cookies and one browser flag, all of which use switches the app already
has:

- `smi-ads=empty` — empties advert inventory for this browser
  (`src/lib/adverts.ts`), so the unseeded `Math.random` shuffle in
  `dealSlots` never runs and slots draw their fixed placeholder (so no
  advert carousel is ever captured).
- `smi-consent=essential` — dismisses the consent banner, which otherwise covers
  the foot of every public page. **It must not be `all`:** `analyticsConsented()`
  only records on `"all"`, and 15 page components call `record()` on GET — so an
  `"all"` run would write `analytics_events` rows that the *next* run's
  `/dashboard/stats` and `/console/analytics` would render. The suite would fail
  against itself.
- `smi-theme=grid` — pins the site design to grid, the one going live, on every
  route (the header, footer and industries bar differ too); the forge homepage is
  its own route (`home@forge`).
- `reducedMotion: "reduce"` — triggers the existing
  `@media (prefers-reduced-motion: reduce)` block in `globals.css`, which stops
  the infinite 26s hero ken-burns pan and every entrance animation.

Plus: fixed 1280×900 viewport at `deviceScaleFactor: 1`, `en-GB`/`Europe/London`,
the cursor parked off-canvas (the hero promotes a card on hover), and a settle
sequence that waits for `networkidle`, `document.fonts.ready` and two frames
rather than sleeping.

## Layout

```
manifest.ts     every route, its role, and where each pinned example came from
runner.ts       pnpm visual        — capture + compare. NEVER writes baseline/
accept.ts       pnpm visual:accept — the only writer of baseline/
lib/            server, auth, capture, elements, diff, cluster, report
baseline/       committed: <id>.png, <id>.elements.json, meta.json
.runs/          gitignored run output, with `latest` symlinked
.state/         gitignored login state — these hold live auth tokens
```

`<id>.elements.json` is the map of where every element was, captured in the same
page state as the screenshot. It is what turns "1.4% of pixels differ" into
"the 'Scheduled' heading moved", and what lets the report say a heading *used to*
read something else.

## Pinned examples

Dynamic routes (`/news/[slug]`, `/console/adverts/[id]`, …) are pinned to one
concrete example each in `manifest.ts`, taken from the database as seeded. A pin
that 404s is reported as an **error**, never skipped — so it gets repinned rather
than quietly losing coverage.

A few routes are marked `skip` with a reason: the member has no submitted
content, and there is no advert bundle or newsletter issue in the current
database. They are listed in every report so they stay visible.

## Why this is not built on Playwright's `toHaveScreenshot`

`toHaveScreenshot()` writes a baseline when it doesn't find one, and
`--update-snapshots` rewrites all of them. Both are exactly what this suite must
never do. A standalone runner has no code path that writes into `baseline/` at
all — that lives in a separate entrypoint. It is a structural guarantee rather
than a policy one, and it is also what makes the region report possible.
