/**
 * Both seed scripts run with the service-role key and bulk-insert into whatever
 * NEXT_PUBLIC_SUPABASE_URL happens to point at. That was harmless while the only
 * target was localhost. Now that a hosted project exists — and a second one lands
 * when the EU/UK project replaces ca-central-1 — a sourced env file is the only
 * thing standing between a local reseed and writing to a live database.
 *
 * So make the remote case explicit rather than incidental.
 */
/**
 * Is this a local Supabase stack rather than a hosted project?
 *
 * Exported because the same question is asked in several places for the same
 * reason: the seeds must not write to a live database by accident, and neither
 * must the integration test suites (tests/setup.ts) or the Playwright smoke
 * suite (tests/smoke/global-setup.ts). One definition, so they cannot drift
 * into disagreeing about what "local" means.
 */
export function isLocalSupabaseUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(url);
}

/**
 * The same rule for the maintenance scripts that write with the service-role
 * key (backfill-industries, create-test-accounts, remove-sample-adverts,
 * audit-test-rows): a local stack by default, a hosted project only with an
 * explicit --remote — which only their `:prod` package script passes. They
 * load .env.local only when the shell has no key of its own, so a shell with
 * production's env sourced (for an earlier `:prod` run, say) would otherwise
 * turn the "local" command into a write to the live database.
 */
export function assertScriptTarget(url: string, script: string, argv: readonly string[] = process.argv): void {
  if (isLocalSupabaseUrl(url) || argv.includes("--remote")) return;

  throw new Error(
    `Refusing to run ${script} against a remote project without --remote.\n` +
      `  target: ${url}\n` +
      `Use its :prod package script, which sources .env.production.local and passes --remote, ` +
      `if that is the intent. Otherwise the shell has a hosted project's env sourced — open a fresh one.`,
  );
}

export function assertSeedTarget(url: string): void {
  const isLocal = isLocalSupabaseUrl(url);
  if (isLocal || process.argv.includes("--remote")) return;

  throw new Error(
    `Refusing to seed a remote project without --remote.\n` +
      `  target: ${url}\n` +
      `The seed scripts expect a fresh database — they create auth users and use ` +
      `plain inserts, so running against an already-seeded project fails on ` +
      `duplicates partway through, leaving it half-written.`,
  );
}
