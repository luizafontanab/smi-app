/**
 * Build and serve the app for a visual-regression run.
 *
 * WHY A PRODUCTION BUILD, ON ITS OWN PORT
 * The dev server on 3100 is long-lived and Turbopack recompiles on demand, so a
 * capture can land mid-compile and the same page renders differently twice in a
 * row. `next start` serves a fixed build. 3100 stays untouched — the run-smi-app
 * skill is explicit that the dev port must not move.
 *
 * WHY THE ENV IS SOURCED IN A SUBSHELL
 * `.env.production.local` exists in this repo and points at the HOSTED Supabase
 * project (see package.json's seed:prod). Next's loader, under NODE_ENV=production,
 * reads .env.production.local BEFORE .env.local — so a plain `next build` would
 * build and screenshot against production data. Variables already present in the
 * environment beat every .env file, so sourcing .env.local into the child's shell
 * first is what pins the build to the local stack. Same trick seed:prod uses in
 * reverse. The values are never read into this process.
 *
 * Module style follows scripts/seed.ts: plain .ts run through tsx, which means
 * CommonJS output — no top-level await and no import.meta in this tree.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export const PORT = Number(process.env.VISUAL_PORT ?? 3200);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Prefix that pins any child command to the local stack (see the header note) and
 * to its own build directory. `next build` cleans its dist dir, so building into
 * `.next` would kill the long-lived dev server on 3100 — and, in a shared working
 * tree, whatever else is using it. next.config.ts reads VISUAL_DIST_DIR.
 */
const WITH_LOCAL_ENV = "set -a && . ./.env.local && set +a && export VISUAL_DIST_DIR=.next-visual && ";

function sh(command: string, opts: { quiet?: boolean } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", WITH_LOCAL_ENV + command], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d;
      if (!opts.quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d;
      if (!opts.quiet) process.stderr.write(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/**
 * Refuse to run against anything but the local Supabase.
 *
 * Prints only the host, never a key — the whole point is that a misconfigured run
 * stops before it screenshots (or writes analytics rows into) production.
 */
export async function assertLocalStack(): Promise<void> {
  const { out } = await sh(`node -e 'process.stdout.write(process.env.NEXT_PUBLIC_SUPABASE_URL || "")'`, {
    quiet: true,
  });
  const url = out.trim();
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local — cannot verify the target stack");
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `visual: refusing to run against a non-local Supabase (${host}). ` +
        "Baselines are only meaningful against the local seeded stack.",
    );
  }
  console.log(`  supabase: ${url} (local)`);
}

/**
 * Confirm the thing answering on our port is OUR app, and is talking to the local
 * stack — not just "something returned a 200".
 *
 * Learned the hard way: an unrelated `next dev` was squatting on 3200, the poll
 * below saw its 200 and declared the server ready, and every capture would have
 * photographed someone else's project. A liveness check that doesn't check
 * identity is worse than none, because it fails silently.
 */
async function assertItIsOurApp(): Promise<void> {
  const res = await fetch(`${BASE_URL}/login`);
  const html = await res.text();
  if (res.status !== 200 || !html.includes('name="email"')) {
    throw new Error(
      `visual: something is answering on ${BASE_URL} but it is not this app ` +
        `(/login returned ${res.status}). Is another dev server on port ${PORT}?`,
    );
  }
  if (html.includes(".supabase.co")) {
    throw new Error(
      "visual: the served build references a hosted Supabase project. " +
        "The build directory was built with the wrong env — rebuild without --no-build.",
    );
  }
}

/**
 * Refuse to start if anything already holds the port. There is deliberately no
 * "reuse the existing server" path: this suite must photograph a build it made
 * itself, or the baselines mean nothing.
 */
async function assertPortFree(): Promise<void> {
  try {
    await fetch(BASE_URL, { redirect: "manual", signal: AbortSignal.timeout(2000) });
  } catch {
    return; // nothing listening, which is what we want
  }
  throw new Error(
    `visual: port ${PORT} is already in use by another process. ` +
      "Stop it, or set VISUAL_PORT to a free port.",
  );
}

export async function build(): Promise<void> {
  console.log("  building (next build)…");
  const { code } = await sh("next build");
  if (code !== 0) throw new Error(`next build failed with exit code ${code}`);
}

export type Server = { stop: () => Promise<void> };

export async function serve(): Promise<Server> {
  await assertPortFree();

  const child: ChildProcess = spawn("bash", ["-c", `${WITH_LOCAL_ENV}next start -p ${PORT}`], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so stop() can take the whole tree down
  });

  let log = "";
  child.stdout?.on("data", (d: Buffer) => (log += d));
  child.stderr?.on("data", (d: Buffer) => (log += d));

  const stop = async (): Promise<void> => {
    if (child.pid && !child.killed) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };

  // Readiness by polling, same contract as scripts/dev-server.sh: the command
  // answering is the readiness signal, not a fixed sleep.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early (code ${child.exitCode}):\n${log}`);
    }
    try {
      const res = await fetch(BASE_URL, { redirect: "manual" });
      if (res.status < 500) {
        await assertItIsOurApp();
        console.log(`  serving: ${BASE_URL}`);
        return { stop };
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`next start did not answer on ${BASE_URL} within 90s:\n${log}`);
}

/** `pnpm visual:server` — build + serve and stay up, for poking at the build by hand. */
async function main(): Promise<void> {
  await assertLocalStack();
  if (!process.argv.includes("--no-build")) await build();
  const server = await serve();
  console.log("  ctrl-c to stop");
  process.on("SIGINT", () => {
    void server.stop().then(() => process.exit(0));
  });
}

if (process.argv[1] && path.basename(process.argv[1]) === "server.ts") {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(3);
  });
}
