/**
 * What a run produces: a JSON contract (which accept.ts reads), a self-contained
 * HTML page for looking at, a markdown version for pasting into a PR, and a
 * terminal summary.
 *
 * The HTML deliberately has no framework and no build step — it has to still open
 * from Finder in three years.
 */
import fs from "node:fs";
import path from "node:path";
import type { Region } from "./diff";
import type { Role } from "../manifest";

export type RouteStatus = "pass" | "changed" | "missing-baseline" | "error" | "skipped";

export type RouteResult = {
  id: string;
  path: string;
  role: Role;
  status: RouteStatus;
  changedPixels?: number;
  changedPct?: number;
  regions?: Region[];
  sizeNote?: string | null;
  capped?: boolean;
  /** accept.ts refuses to promote a file whose bytes no longer hash to this. */
  currentSha256?: string;
  error?: string;
  skip?: string;
};

export type Fingerprint = {
  platform: string;
  chromium: string;
  next: string;
  capturedAt: string;
};

export type Report = {
  startedAt: string;
  durationMs: number;
  fingerprint: Fingerprint;
  baselineFingerprint: Fingerprint | null;
  fingerprintMatches: boolean;
  totals: Record<string, number>;
  routes: RouteResult[];
};

export function totalsOf(routes: RouteResult[]): Record<string, number> {
  const t = { routes: routes.length, pass: 0, changed: 0, "missing-baseline": 0, error: 0, skipped: 0 };
  for (const r of routes) t[r.status]++;
  return t;
}

/**
 * 0 all match · 1 something changed · 2 the run is not a valid comparison
 * (a missing baseline or a route that errored) · 3 setup failure.
 *
 * 2 outranks 1 on purpose: a missing baseline must never be reportable as an
 * ordinary diff, because the fix for the two is completely different.
 */
export function exitCodeFor(t: Record<string, number>): number {
  if (t["missing-baseline"] > 0 || t.error > 0) return 2;
  if (t.changed > 0) return 1;
  return 0;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (n: number | undefined): string => (n === undefined ? "" : `${n.toFixed(3)}%`);

export function writeReport(runDir: string, report: Report): void {
  fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(runDir, "report.md"), markdown(report));
  fs.writeFileSync(path.join(runDir, "report.html"), html(report));
}

function regionRows(r: RouteResult): string {
  return (r.regions ?? [])
    .map(
      (g) => `<tr><td>${g.n}</td><td>${esc(g.name)}${
        g.wasNamed ? `<div class="was">was: ${esc(g.wasNamed)}</div>` : ""
      }</td><td class="num">${g.box[0]},${g.box[1]}</td><td class="num">${g.box[2]}×${g.box[3]}</td><td class="num">${
        g.changedPixels
      }</td><td><code>${esc(g.selector)}</code></td></tr>`,
    )
    .join("");
}

function html(report: Report): string {
  const interesting = report.routes.filter((r) => r.status !== "pass" && r.status !== "skipped");
  const t = report.totals;

  const sections = interesting
    .map((r) => {
      const images =
        r.status === "changed"
          ? `<div class="shots">
               <figure><figcaption>baseline</figcaption><img src="../../baseline/${r.id}.png" loading="lazy"></figure>
               <figure><figcaption>current</figcaption><img src="current/${r.id}.png" loading="lazy"></figure>
               <figure><figcaption>diff</figcaption><img src="diff/${r.id}.png" loading="lazy"></figure>
             </div>`
          : "";
      const table =
        r.regions && r.regions.length
          ? `<table><thead><tr><th>#</th><th>region</th><th>at</th><th>size</th><th>px</th><th>selector</th></tr></thead><tbody>${regionRows(
              r,
            )}</tbody></table>`
          : "";
      return `<section class="route ${r.status}">
        <h2><span class="badge">${r.status}</span> ${esc(r.path)}</h2>
        <p class="meta">${esc(r.id)} · ${r.role}${r.changedPct !== undefined ? ` · ${pct(r.changedPct)} of pixels` : ""}${
          r.sizeNote ? ` · ${esc(r.sizeNote)}` : ""
        }${r.capped ? " · region list capped" : ""}</p>
        ${r.error ? `<p class="err">${esc(r.error)}</p>` : ""}
        <p class="accept">accept this one: <code>pnpm visual:accept ${esc(r.id)}</code></p>
        ${table}
        ${images}
      </section>`;
    })
    .join("");

  return `<!doctype html><meta charset="utf-8"><title>Visual regression — ${report.startedAt}</title>
<style>
  :root { color-scheme: light dark; --line:#d8d8dc; --muted:#666; --bg:#fff; --fg:#111; }
  @media (prefers-color-scheme: dark) { :root { --line:#333; --muted:#999; --bg:#141416; --fg:#eee; } }
  body { font:14px/1.5 ui-sans-serif,system-ui,sans-serif; margin:0; padding:2rem; background:var(--bg); color:var(--fg); }
  h1 { font-size:1.4rem; margin:0 0 .25rem; }
  .totals { color:var(--muted); margin-bottom:2rem; }
  .route { border-top:1px solid var(--line); padding:1.5rem 0; }
  h2 { font-size:1.05rem; margin:0 0 .25rem; font-weight:600; }
  .badge { font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; padding:.15rem .4rem; border-radius:3px; background:#ffd23f; color:#111; }
  .missing-baseline .badge, .error .badge { background:#ff4d4d; color:#fff; }
  .meta, .accept { color:var(--muted); margin:.25rem 0; }
  .err { color:#ff4d4d; }
  code { font:12px ui-monospace,SFMono-Regular,Menlo,monospace; }
  table { border-collapse:collapse; margin:1rem 0; font-size:13px; width:100%; }
  th, td { text-align:left; padding:.3rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .was { color:var(--muted); font-size:12px; }
  .shots { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; overflow-x:auto; }
  figure { margin:0; }
  figcaption { color:var(--muted); font-size:12px; margin-bottom:.25rem; }
  img { width:100%; border:1px solid var(--line); }
</style>
<h1>Visual regression</h1>
<p class="totals">${report.startedAt} · ${(report.durationMs / 1000).toFixed(0)}s ·
  ${t.routes} routes · ${t.pass} pass · ${t.changed} changed · ${t["missing-baseline"]} missing baseline ·
  ${t.error} error · ${t.skipped} skipped<br>
  ${report.fingerprint.platform} · chromium ${report.fingerprint.chromium} · next ${report.fingerprint.next}
  ${report.fingerprintMatches ? "" : '<strong style="color:#ff4d4d">— baseline was captured on a different setup, expect noise</strong>'}
</p>
${sections || "<p>Nothing to report — every route matched its baseline.</p>"}
`;
}

function markdown(report: Report): string {
  const t = report.totals;
  const lines = [
    `# Visual regression — ${report.startedAt}`,
    "",
    `${t.routes} routes · ${t.pass} pass · ${t.changed} changed · ${t["missing-baseline"]} missing baseline · ${t.error} error · ${t.skipped} skipped`,
    "",
  ];
  for (const r of report.routes) {
    if (r.status === "pass" || r.status === "skipped") continue;
    lines.push(`## ${r.status.toUpperCase()} — \`${r.path}\``);
    if (r.error) lines.push("", r.error);
    if (r.sizeNote) lines.push("", r.sizeNote);
    if (r.regions?.length) {
      lines.push("", "| # | region | at | size | px |", "|---|---|---|---|---|");
      for (const g of r.regions) {
        lines.push(
          `| ${g.n} | ${g.name}${g.wasNamed ? ` (was: ${g.wasNamed})` : ""} | ${g.box[0]},${g.box[1]} | ${g.box[2]}×${g.box[3]} | ${g.changedPixels} |`,
        );
      }
    }
    lines.push("", `\`pnpm visual:accept ${r.id}\``, "");
  }
  return lines.join("\n");
}

/** The terse thing printed at the end of a run. */
export function printSummary(report: Report, runDir: string): void {
  const t = report.totals;
  const secs = (report.durationMs / 1000).toFixed(0);
  console.log("");
  console.log(
    `visual: ${t.routes} routes · ${t.pass} pass · ${t.changed} changed · ` +
      `${t["missing-baseline"]} missing baseline · ${t.error} error · ${t.skipped} skipped   (${secs}s)`,
  );
  console.log("");

  if (!report.fingerprintMatches && report.baselineFingerprint) {
    console.log(
      `  ! baseline captured on ${report.baselineFingerprint.platform} / chromium ` +
        `${report.baselineFingerprint.chromium}; this run is ${report.fingerprint.platform} / ` +
        `chromium ${report.fingerprint.chromium}. Expect environmental noise.`,
    );
    console.log("");
  }

  const order: RouteStatus[] = ["missing-baseline", "error", "changed", "skipped"];
  for (const status of order) {
    for (const r of report.routes.filter((x) => x.status === status)) {
      if (status === "missing-baseline") {
        console.log(`  MISSING  ${r.path.padEnd(38)} no baseline — \`pnpm visual:accept ${r.id}\``);
      } else if (status === "error") {
        console.log(`  ERROR    ${r.path.padEnd(38)} ${r.error}`);
      } else if (status === "skipped") {
        console.log(`  skipped  ${r.path.padEnd(38)} ${r.skip}`);
      } else {
        const head = `  CHANGED  ${r.path.padEnd(38)} ${pct(r.changedPct).padStart(8)}  ${r.regions?.length ?? 0} regions`;
        console.log(r.sizeNote ? `${head}  [${r.sizeNote}]` : head);
        for (const g of (r.regions ?? []).slice(0, 6)) {
          const was = g.wasNamed ? `   was: ${g.wasNamed}` : "";
          console.log(`             ${String(g.n).padStart(2)}. ${g.name.padEnd(44)} (${g.box[0]},${g.box[1]} ${g.box[2]}×${g.box[3]})${was}`);
        }
        if ((r.regions?.length ?? 0) > 6) console.log(`             … ${(r.regions?.length ?? 0) - 6} more in the report`);
      }
    }
  }

  console.log("");
  console.log(`  report: ${path.join(runDir, "report.html")}`);
  console.log("");
}
