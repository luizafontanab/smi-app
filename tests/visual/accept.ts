/**
 * `pnpm visual:accept` — the ONLY thing in this suite that writes to baseline/.
 *
 * It is a separate entrypoint from the runner on purpose. Nothing that runs
 * automatically can promote a capture to a baseline; a person has to name what
 * they are accepting, after looking at it. That is the whole reason this suite
 * is not built on Playwright's toHaveScreenshot, which writes a baseline the
 * first time it doesn't find one.
 *
 *   pnpm visual:accept <id> [<id>…]   accept these routes (the usual case)
 *   pnpm visual:accept --changed      every route that changed
 *   pnpm visual:accept --new          every route with no baseline yet
 *   pnpm visual:accept --all          both, after typing a confirmation
 *   pnpm visual:accept --prune-orphans  delete baselines with no manifest entry
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { ROUTES } from "./manifest";
import type { Report, RouteResult } from "./lib/report";
import { BASELINE_DIR, RUNS_DIR } from "./lib/paths";

const sha256 = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");

function loadLatest(): { report: Report; runDir: string } {
  const runDir = path.join(RUNS_DIR, "latest");
  const reportPath = path.join(runDir, "report.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error("no run to accept from — run `pnpm visual` first");
  }
  return { report: JSON.parse(fs.readFileSync(reportPath, "utf8")), runDir };
}

/** Which routes the flags/arguments select. */
function chooseRoutes(report: Report): RouteResult[] {
  const argv = process.argv.slice(2);
  const ids = argv.filter((a) => !a.startsWith("-"));
  const flag = (f: string): boolean => argv.includes(f);

  const acceptable = report.routes.filter((r) => r.status === "changed" || r.status === "missing-baseline");

  if (ids.length) {
    const known = new Map(acceptable.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = known.get(id);
      if (!r) {
        const status = report.routes.find((x) => x.id === id)?.status;
        throw new Error(
          status
            ? `"${id}" has nothing to accept (status: ${status})`
            : `"${id}" is not in the latest run`,
        );
      }
      return r;
    });
  }

  if (flag("--all")) return acceptable;
  if (flag("--changed")) return acceptable.filter((r) => r.status === "changed");
  // Deliberately a separate flag from --changed: "I added a page" and "I changed
  // a page" are different intents and should not share a keystroke.
  if (flag("--new")) return acceptable.filter((r) => r.status === "missing-baseline");

  throw new Error("nothing selected — pass route ids, or --changed / --new / --all");
}

async function confirm(count: number): Promise<boolean> {
  if (process.argv.includes("--yes")) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Accept ${count} baselines? type 'accept' to confirm: `);
    return answer.trim() === "accept";
  } finally {
    rl.close();
  }
}

function pruneOrphans(): void {
  const known = new Set(ROUTES.map((r) => r.id));
  const orphans = fs
    .readdirSync(BASELINE_DIR)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .filter((id) => !known.has(id));

  if (orphans.length === 0) {
    console.log("no orphaned baselines");
    return;
  }
  for (const id of orphans) {
    fs.rmSync(path.join(BASELINE_DIR, `${id}.png`), { force: true });
    fs.rmSync(path.join(BASELINE_DIR, `${id}.elements.json`), { force: true });
    console.log(`  removed orphan ${id}`);
  }
}

async function main(): Promise<void> {
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    console.error("visual: refusing to run in CI — baselines are machine-local.");
    process.exit(3);
  }

  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  if (process.argv.includes("--prune-orphans")) {
    pruneOrphans();
    if (process.argv.slice(2).every((a) => a === "--prune-orphans")) return;
  }

  const { report, runDir } = loadLatest();
  const chosen = chooseRoutes(report);

  if (chosen.length === 0) {
    console.log("nothing to accept — the latest run had no changed or missing routes");
    return;
  }

  if (process.argv.includes("--all") && !(await confirm(chosen.length))) {
    console.log("aborted; nothing written");
    return;
  }

  // A baseline is only meaningful if it is the exact file that was reviewed. If
  // the PNG on disk no longer hashes to what the report recorded, the run is
  // stale (or the file was edited) and accepting it would enshrine something
  // nobody looked at.
  for (const r of chosen) {
    const src = path.join(runDir, "current", `${r.id}.png`);
    if (!fs.existsSync(src)) throw new Error(`${r.id}: no capture in the latest run`);
    if (r.currentSha256 && sha256(fs.readFileSync(src)) !== r.currentSha256) {
      throw new Error(`${r.id}: capture on disk does not match the report — re-run \`pnpm visual\``);
    }
  }

  const metaPath = path.join(BASELINE_DIR, "meta.json");
  const meta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
    : { fingerprint: report.fingerprint, routes: {} as Record<string, unknown> };
  meta.fingerprint = report.fingerprint;

  for (const r of chosen) {
    for (const ext of ["png", "elements.json"]) {
      const src = path.join(runDir, "current", `${r.id}.${ext}`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BASELINE_DIR, `${r.id}.${ext}`));
    }
    meta.routes[r.id] = {
      acceptedAt: new Date().toISOString(),
      sha256: r.currentSha256,
      path: r.path,
      from: r.status,
    };
    console.log(`  accepted ${r.id}  (${r.status === "missing-baseline" ? "new" : "updated"})`);
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log("");
  console.log(`${chosen.length} baseline(s) written to tests/visual/baseline/`);
  console.log("Review and commit them:  git add tests/visual/baseline");
}

main().catch((e) => {
  console.error(`visual:accept: ${e instanceof Error ? e.message : e}`);
  process.exit(3);
});
