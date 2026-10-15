import fs from "node:fs";
import path from "node:path";
import { isLocalSupabaseUrl } from "../../scripts/lib/target-guard";
import { serverTargetProblem } from "./target";

const KEY = "NEXT_PUBLIC_SUPABASE_URL";
const BASE_URL = "http://127.0.0.1:3100";

/**
 * One value from a KEY=value env file, without loading the rest of it — the
 * file also holds the secret key, which this suite has no use for.
 */
function readKey(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === KEY && !line.trimStart().startsWith("#")) return m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

/**
 * The Supabase URL `next dev` will use, in its own precedence order: the real
 * environment, then .env.development.local, then .env.local.
 */
function supabaseUrl(): string | undefined {
  const root = path.resolve(__dirname, "../..");
  return process.env[KEY] ?? readKey(path.join(root, ".env.development.local")) ?? readKey(path.join(root, ".env.local"));
}

/**
 * Refuse to run unless the app is pointed at the local Supabase stack. Shared
 * by both Playwright suites: this one (playwright.smoke.config.ts) and the e2e
 * suite (tests/e2e/global-setup.ts), which writes through the dev server on
 * purpose and so needs it more.
 *
 * The smoke specs only read, but a page view still reaches the database
 * (sign-in sessions, the consent counter), and "only reads" is a promise the
 * request guard in fixtures.ts can check in the browser but not on the server.
 * So the target itself must be local — the same rule tests/setup.ts applies to
 * vitest and the seeds apply to themselves.
 *
 * Two checks, because they answer different questions. The env files say what
 * a freshly started server would use. But both configs set
 * `reuseExistingServer`, and a server already running on 3100 may have been
 * started from another shell, with other env. So the running server is asked
 * too, through the Supabase origin it reports in its own CSP header — see
 * serverTargetProblem. A server that can't be verified that way is refused,
 * not trusted.
 */
export async function assertLocalTarget(suite: string): Promise<void> {
  const url = supabaseUrl();
  if (!url) throw new Error(`${suite}: ${KEY} is not set — cannot verify the target is the local Supabase stack.`);
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `${suite}: refusing to run against a non-local Supabase (${new URL(url).hostname}). ` +
        "Point .env.local at the local stack (supabase status) and restart the dev server.",
    );
  }

  // Confirm whatever answers on 3100 is this app, not an unrelated server that
  // webServer.reuseExistingServer would happily accept.
  const res = await fetch(`${BASE_URL}/login`);
  const html = await res.text();
  if (res.status !== 200 || !html.includes('name="email"')) {
    throw new Error(`${suite}: ${BASE_URL}/login did not return the SMI login form (status ${res.status}) — is another app on port 3100?`);
  }

  const problem = serverTargetProblem(res.headers.get("content-security-policy"), url);
  if (problem) throw new Error(`${suite}: refusing to use the server on ${BASE_URL}: ${problem}.`);
}

export default async function globalSetup(): Promise<void> {
  await assertLocalTarget("smoke");
}
