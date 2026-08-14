/**
 * Both seed scripts run with the service-role key and bulk-insert into whatever
 * NEXT_PUBLIC_SUPABASE_URL happens to point at. That was harmless while the only
 * target was localhost. Now that a hosted project exists — and a second one lands
 * when the EU/UK project replaces ca-central-1 — a sourced env file is the only
 * thing standing between a local reseed and writing to a live database.
 *
 * So make the remote case explicit rather than incidental.
 */
export function assertSeedTarget(url: string): void {
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(url);
  if (isLocal || process.argv.includes("--remote")) return;

  throw new Error(
    `Refusing to seed a remote project without --remote.\n` +
      `  target: ${url}\n` +
      `The seed scripts expect a fresh database — they create auth users and use ` +
      `plain inserts, so running against an already-seeded project fails on ` +
      `duplicates partway through, leaving it half-written.`,
  );
}
