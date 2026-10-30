import { isLocalSupabaseUrl } from "../../scripts/lib/target-guard";

/**
 * Which database a Playwright run is really pointed at — pure helpers shared by
 * both suites' global setup (global-setup.ts) and the smoke suite's browser
 * guard (fixtures.ts), kept free of Playwright imports so tests/unit can pin
 * them.
 */

/** This machine, as a URL's `hostname` spells it. */
export const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Supabase's own API surfaces. A custom domain in front of a hosted project still serves these. */
const SUPABASE_API_PATH = /^\/(rest|auth|storage|realtime|functions|graphql)\/v1(\/|$)/;
/** Supabase's hosted domains: projects, and the API/storage hosts behind them. */
const SUPABASE_HOSTED = /(^|\.)supabase\.(co|in|net|com)$/;

/**
 * A request that reaches a Supabase project other than one on this machine —
 * by hosted domain, or by Supabase's API paths on any non-local host, so a
 * project behind a custom domain is caught too (the old check knew only
 * *.supabase.co/.in).
 */
export function isRemoteSupabaseRequest(url: URL): boolean {
  if (LOCAL_HOSTS.has(url.hostname)) return false;
  return SUPABASE_HOSTED.test(url.hostname) || SUPABASE_API_PATH.test(url.pathname);
}

/** Third parties the app's CSP allows the browser to call (Stripe, Google Maps). None of them is a database. */
const THIRD_PARTY_CONNECT = /(^|\.)(stripe\.com|googleapis\.com|google\.com|gstatic\.com)$/;

/** Every http(s) origin in a Content-Security-Policy's connect-src. */
export function connectSrcOrigins(csp: string | null): string[] {
  const directive = csp
    ?.split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("connect-src "));
  if (!directive) return [];
  return directive
    .split(/\s+/)
    .slice(1)
    .filter((token) => /^https?:\/\//.test(token))
    .flatMap((token) => {
      try {
        return [new URL(token).origin];
      } catch {
        return [];
      }
    });
}

/**
 * Why the server answering on the base URL can't be trusted with a test run,
 * or null if it can.
 *
 * Reading env files says what a server started now WOULD use, not what the one
 * already running (`reuseExistingServer`) was started with. The running
 * server's own answer is in its Content-Security-Policy: next.config.ts puts
 * the Supabase origin from the NEXT_PUBLIC_SUPABASE_URL that process loaded
 * into connect-src, and reads it once, at start — the same moment, and the
 * same variable, lib/db/server.ts reads. So: every non-third-party origin
 * there must be local, and the one the env files name must be among them.
 * No origin at all means it can't be verified, which is refused too.
 */
export function serverTargetProblem(csp: string | null, expectedUrl: string): string | null {
  const origins = connectSrcOrigins(csp).filter((o) => !THIRD_PARTY_CONNECT.test(new URL(o).hostname));
  if (!origins.length) {
    return "its Content-Security-Policy names no Supabase origin in connect-src, so which database it uses cannot be verified";
  }
  const remote = origins.filter((o) => !isLocalSupabaseUrl(o));
  if (remote.length) return `it is talking to ${remote.join(", ")}`;
  const expected = new URL(expectedUrl).origin;
  if (!origins.includes(expected)) {
    return `it was started against ${origins.join(", ")}, not the ${expected} the env files now name — restart it (pnpm dev:stop)`;
  }
  return null;
}
