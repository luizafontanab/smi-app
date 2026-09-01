import { vi } from "vitest";

/**
 * Manual mock for lib/db/server.ts, one level up from the raw client fakes in
 * ./supabase.ts. Wire it up per test file with:
 *
 *   vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
 *
 * then configure what each client returns per test:
 *
 *   import { serviceDb } from "@/lib/db/server";
 *   vi.mocked(serviceDb).mockReturnValue(mockDb({ ... }));
 *
 * mediaUrl is a working fake rather than a bare vi.fn() — most callers just
 * need a stable, inspectable URL back, not to configure one per test.
 */

export const serviceDb = vi.fn();
export const sessionDb = vi.fn();
export const publicDb = vi.fn();
export const mediaUrl = vi.fn((path: string | null | undefined): string | null =>
  path ? `https://cdn.test/storage/v1/object/public/media/${path}` : null,
);

/** Call in afterEach so mock return values/call history don't leak between tests in the same file. */
export function resetDbServerMocks() {
  serviceDb.mockReset();
  sessionDb.mockReset();
  publicDb.mockReset();
  mediaUrl.mockClear();
}
