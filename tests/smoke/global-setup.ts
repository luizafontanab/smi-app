import fs from "node:fs";
import path from "node:path";
import { isLocalSupabaseUrl } from "../../scripts/lib/target-guard";

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
 * Refuse to run unless the app is pointed at the local Supabase stack.
 *
 * The smoke specs only read, but a page view still reaches the database
 * (sign-in sessions, the consent counter), and "only reads" is a promise the
 * request guard in fixtures.ts can check in the browser but not on the server.
 * So the target itself must be local — the same rule tests/setup.ts applies to
 * vitest and the seeds apply to themselves.
 */
export default async function globalSetup(): Promise<void> {
  const url = supabaseUrl();
  if (!url) throw new Error(`smoke: ${KEY} is not set — cannot verify the target is the local Supabase stack.`);
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `smoke: refusing to run against a non-local Supabase (${new URL(url).hostname}). ` +
        "Point .env.local at the local stack (supabase status) and restart the dev server.",
    );
  }

  // Confirm whatever answers on 3100 is this app, not an unrelated server that
  // webServer.reuseExistingServer would happily accept.
  const res = await fetch(`${BASE_URL}/login`);
  const html = await res.text();
  if (res.status !== 200 || !html.includes('name="email"')) {
    throw new Error(`smoke: ${BASE_URL}/login did not return the SMI login form (status ${res.status}) — is another app on port 3100?`);
  }
}
