import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * Fakes for unit-testing code that calls serviceDb()/sessionDb()/publicDb()
 * from lib/db/server.ts. Supabase's real PostgrestQueryBuilder is both
 * chainable (`.select().eq().order()`) and directly awaitable at any point
 * in the chain (it implements PromiseLike) — callers use both styles, so the
 * fake has to support both rather than special-casing one shape per table.
 *
 * Usage — mock the module once per test file, then configure per test:
 *
 *   vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
 *   import { serviceDb } from "@/lib/db/server";
 *   import { mockDb, fromByTable, queryBuilder, dbOk } from "../stubs/supabase";
 *
 *   vi.mocked(serviceDb).mockReturnValue(mockDb({
 *     from: fromByTable({ redirects: () => queryBuilder(dbOk({ to_path: "b", status_code: 301 })) }),
 *   }));
 */

export type DbResult<T = unknown> =
  | { data: T; error: null; count?: number | null }
  | { data: null; error: { message: string; code?: string; [key: string]: unknown }; count?: number | null };

export const dbOk = <T>(data: T, count?: number | null): DbResult<T> => ({ data, error: null, count });
export const dbError = (message: string, extra: Record<string, unknown> = {}): DbResult<null> => ({
  data: null,
  error: { message, ...extra },
});

/** Every filter/modifier PostgrestFilterBuilder method this codebase calls. Extend as new ones show up. */
const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
  "in", "is", "contains", "overlaps", "match", "not", "or", "textSearch", "filter",
  "order", "limit", "range", "returns", "throwOnError", "single", "maybeSingle",
] as const;

/**
 * A chainable, thenable fake query builder. `result` is what awaiting the
 * chain resolves to, no matter how deep the chain went or which terminal
 * method (if any) was called — the fake doesn't attempt to model filtering,
 * so it's the test's job to configure the result that matches the scenario
 * under test. Pass a function instead of a static result to compute it
 * lazily (e.g. from a call counter, for a loop that queries more than once).
 */
export function queryBuilder<T = unknown>(result: DbResult<T> | (() => DbResult<T>) = dbOk(null as T)) {
  const builder: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) builder[method] = vi.fn(() => builder);
  builder.then = (onFulfilled?: ((v: DbResult<T>) => unknown) | null, onRejected?: ((e: unknown) => unknown) | null) =>
    Promise.resolve(typeof result === "function" ? result() : result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: (e: unknown) => unknown) =>
    Promise.resolve(typeof result === "function" ? result() : result).catch(onRejected);
  return builder;
}

/**
 * Routes `.from(table)` calls by table name. With no `fallback`, an
 * unconfigured table throws so a missing case fails loudly rather than
 * silently returning nulls — pass one (e.g. `() => queryBuilder()`) for code
 * that touches many tables per call and only a few matter to a given test.
 */
export function fromByTable(
  map: Record<string, () => ReturnType<typeof queryBuilder>>,
  fallback?: () => ReturnType<typeof queryBuilder>,
) {
  return vi.fn((table: string) => {
    const factory = map[table] ?? fallback;
    if (!factory) throw new Error(`mockDb: no queryBuilder configured for table "${table}"`);
    return factory();
  });
}

/** Yields the next configured result each call a `.from(table)` factory makes, repeating the last one once exhausted — for code that queries the same table more than once per run with a different result expected each time. */
export function sequence<T = unknown>(...results: DbResult<T>[]) {
  let i = 0;
  return () => queryBuilder(results[Math.min(i++, results.length - 1)]);
}

/** A fake Supabase client covering .from(), .auth, .storage and .rpc — the surface lib/db/server.ts's clients expose. */
export function mockDb(overrides: {
  from?: (table: string) => ReturnType<typeof queryBuilder>;
  auth?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  rpc?: (...args: unknown[]) => unknown;
} = {}) {
  return {
    from: vi.fn(overrides.from ?? (() => queryBuilder())),
    auth: overrides.auth ?? { getUser: vi.fn(async () => dbOk({ user: null })) },
    storage: overrides.storage ?? {
      from: vi.fn(() => ({
        upload: vi.fn(async () => dbOk(null)),
        remove: vi.fn(async () => dbOk(null)),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "" } })),
      })),
    },
    rpc: vi.fn(overrides.rpc ?? (async () => dbOk(null))),
  };
}

/**
 * serviceDb()/sessionDb()/publicDb() are typed to return the real
 * SupabaseClient<Database> — a fully-typed fake of that generic type isn't
 * practical, so this is the one sanctioned cast site: build with mockDb(),
 * then pass through here when handing the result to mockReturnValue/
 * mockResolvedValue.
 */
export function asDb(db: ReturnType<typeof mockDb>): SupabaseClient<Database> {
  return db as unknown as SupabaseClient<Database>;
}
