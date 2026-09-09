/**
 * `pnpm visual` — capture every route in the manifest and compare it to the
 * committed baseline.
 *
 * THIS FILE NEVER WRITES TO baseline/. That is a structural guarantee, not a
 * policy one: promoting a capture to a baseline lives in accept.ts, which is a
 * separate entrypoint a person has to invoke on purpose. A missing baseline is
 * therefore a hard failure here, never a silent first write — which is exactly
 * what Playwright's toHaveScreenshot does, and the reason this suite is a
 * standalone runner rather than a Playwright project.
 *
 * Exit codes: 0 all match · 1 something changed · 2 missing baseline or route
 * error · 3 setup failure.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "playwright";

import { ROUTES, type Role, type Route } from "./manifest";
import { DEFAULT_COOKIES, ensureStates, verifyStates } from "./lib/auth";
import { capture, launch, makeContext } from "./lib/capture";
import { diff } from "./lib/diff";
import type { ElementBox } from "./lib/elements";
import {
  exitCodeFor,
  printSummary,
  totalsOf,
  writeReport,
  type Fingerprint,
  type Report,
  type RouteResult,
} from "./lib/report";
import { BASELINE_DIR, RUNS_DIR } from "./lib/paths";
import { assertLocalStack, BASE_URL, build, REPO_ROOT, serve } from "./lib/server";

/**
 * Baselines are captured on one machine with one Chromium build. A Linux CI
 * runner rasterises fonts differently and would fail essentially every route, so
 * this suite is human-triggered only and says so out loud rather than producing
 * a wall of meaningless red.
 */
function refuseInCI(): void {
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    console.error("visual: refusing to run in CI — baselines are machine-local. See tests/visual/README.md");
    process.exit(3);
  }
}

function fingerprint(chromiumVersion: string): Fingerprint {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  return {
    platform: `${process.platform}-${process.arch}`,
    chromium: chromiumVersion,
    next: pkg.dependencies?.next ?? "unknown",
    capturedAt: new Date().toISOString(),
  };
}

const sha256 = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `--only 'console_*'` — glob on the route id, or a plain substring. */
function selectRoutes(): Route[] {
  let routes = ROUTES;
  const role = argValue("--role") as Role | undefined;
  if (role) routes = routes.filter((r) => r.role === role);
  const only = argValue("--only");
  if (only) {
    const re = new RegExp(`^${only.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    routes = routes.filter((r) => re.test(r.id) || r.id.includes(only));
  }
  return routes;
}

/** Runs `jobs` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await work(items[i]);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  refuseInCI();

  const startedAt = new Date();
  const concurrency = Number(argValue("--concurrency") ?? 2);
  const routes = selectRoutes();
  if (routes.length === 0) throw new Error("no routes selected");

  console.log(`visual: ${routes.length} routes`);
  await assertLocalStack();
  if (!process.argv.includes("--no-build")) await build();
  const server = await serve();

  const browser = await launch();
  const results: RouteResult[] = [];

  // Run directory is created up front so a crash still leaves the captures.
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(RUNS_DIR, stamp);
  fs.mkdirSync(path.join(runDir, "current"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "diff"), { recursive: true });

  try {
    console.log("  logging in…");
    const states = await ensureStates(browser, BASE_URL);
    await verifyStates(browser, BASE_URL, states);

    const contexts: Partial<Record<Role, BrowserContext>> = {};
    for (const role of ["anon", "member", "admin"] as Role[]) {
      contexts[role] = await makeContext(browser, BASE_URL, states[role]);
    }

    let done = 0;
    await pool(routes, concurrency, async (route) => {
      const label = `[${String(++done).padStart(3)}/${routes.length}] ${route.path}`;

      if (route.skip) {
        results.push({ id: route.id, path: route.path, role: route.role, status: "skipped", skip: route.skip });
        console.log(`${label} — skipped`);
        return;
      }

      // A route with its own cookies (the grid homepage) needs its own context.
      let context = contexts[route.role]!;
      let temp: BrowserContext | null = null;
      if (route.cookies?.length) {
        temp = await makeContext(browser, BASE_URL, states[route.role]);
        await temp.addCookies(
          [...DEFAULT_COOKIES, ...route.cookies].map((c) => ({ ...c, url: BASE_URL })),
        );
        context = temp;
      }

      try {
        const shot = await capture(context, route);

        const currentPng = path.join(runDir, "current", `${route.id}.png`);
        fs.writeFileSync(currentPng, shot.png);
        fs.writeFileSync(
          path.join(runDir, "current", `${route.id}.elements.json`),
          JSON.stringify(shot.elements),
        );

        const baselinePng = path.join(BASELINE_DIR, `${route.id}.png`);
        if (!fs.existsSync(baselinePng)) {
          results.push({
            id: route.id,
            path: route.path,
            role: route.role,
            status: "missing-baseline",
            currentSha256: sha256(shot.png),
          });
          console.log(`${label} — no baseline`);
          return;
        }

        const baselineElementsPath = path.join(BASELINE_DIR, `${route.id}.elements.json`);
        const baselineElements: ElementBox[] = fs.existsSync(baselineElementsPath)
          ? JSON.parse(fs.readFileSync(baselineElementsPath, "utf8"))
          : [];

        const result = await diff(
          fs.readFileSync(baselinePng),
          shot.png,
          shot.elements,
          baselineElements,
        );

        if (result.changedPixels === 0) {
          results.push({ id: route.id, path: route.path, role: route.role, status: "pass" });
          console.log(`${label} — ok`);
          return;
        }

        fs.writeFileSync(path.join(runDir, "diff", `${route.id}.png`), result.diffPng);
        results.push({
          id: route.id,
          path: route.path,
          role: route.role,
          status: "changed",
          changedPixels: result.changedPixels,
          changedPct: result.changedPct,
          regions: result.regions,
          sizeNote: result.sizeNote,
          capped: result.capped,
          currentSha256: sha256(shot.png),
        });
        console.log(`${label} — CHANGED (${result.regions.length} regions)`);
      } catch (e) {
        const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
        results.push({ id: route.id, path: route.path, role: route.role, status: "error", error: message });
        console.log(`${label} — ERROR ${message}`);
      } finally {
        if (temp) await temp.close();
      }
    });

    const current = fingerprint(browser.version());
    const metaPath = path.join(BASELINE_DIR, "meta.json");
    const baselineMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null;
    const baselineFingerprint: Fingerprint | null = baselineMeta?.fingerprint ?? null;

    // Keep the manifest's order in the report, not completion order.
    const order = new Map(routes.map((r, i) => [r.id, i]));
    results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const report: Report = {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      fingerprint: current,
      baselineFingerprint,
      fingerprintMatches:
        !baselineFingerprint ||
        (baselineFingerprint.platform === current.platform && baselineFingerprint.chromium === current.chromium),
      totals: totalsOf(results),
      routes: results,
    };

    writeReport(runDir, report);

    // `latest` is what visual:report and accept.ts read. unlink, not rm: rmSync
    // stats through the symlink and refuses with EISDIR when it points at a
    // directory, which it always does.
    const latest = path.join(RUNS_DIR, "latest");
    try {
      fs.unlinkSync(latest);
    } catch {
      // first run, or already gone
    }
    fs.symlinkSync(stamp, latest);

    printSummary(report, runDir);
    process.exitCode = exitCodeFor(report.totals);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e) => {
  console.error(`visual: ${e instanceof Error ? e.message : e}`);
  process.exit(3);
});
