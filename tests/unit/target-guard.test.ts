import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "../../scripts/lib/target-guard";

/**
 * `isLocalSupabaseUrl` is now the single definition of "safe to write to",
 * consulted by both the seed scripts (scripts/lib/target-guard.ts) and the test
 * runner (tests/setup.ts). A false positive here means a seed run or a
 * `pnpm check` writes to a live database believing it is local — which is
 * exactly what happened on 25 Sep 2026, before the second caller existed.
 *
 * The hostile cases matter more than the happy ones: a hosted project whose
 * name merely *contains* "localhost" must not pass.
 */
describe("isLocalSupabaseUrl", () => {
  it("accepts the local stack in the forms supabase status reports", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:56321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:56321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:56321")).toBe(true);
  });

  it("accepts a local host with no port and with a trailing path", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost/rest/v1")).toBe(true);
  });

  it("accepts https on a local host", () => {
    expect(isLocalSupabaseUrl("https://localhost:56321")).toBe(true);
  });

  it("rejects a hosted Supabase project", () => {
    expect(isLocalSupabaseUrl("https://bvyxeujhecxulzwvpxfr.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://kgjnwyojgajcvsberods.supabase.co")).toBe(false);
  });

  it("rejects a remote host that merely contains a local-looking name", () => {
    // The check is anchored, so none of these may slip through.
    expect(isLocalSupabaseUrl("https://localhost.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://not-localhost.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://example.com/?host=127.0.0.1")).toBe(false);
  });

  it("rejects an empty or malformed value rather than defaulting to permissive", () => {
    expect(isLocalSupabaseUrl("")).toBe(false);
    expect(isLocalSupabaseUrl("127.0.0.1:56321")).toBe(false); // no scheme
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });
});
