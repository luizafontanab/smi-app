import { vi } from "vitest";

/**
 * Aliased over "next/cache" in vitest.config.ts. The real revalidatePath()/
 * revalidateTag() throw ("Invariant: static generation store missing")
 * outside Next's own request/build machinery — confirmed by hand, the same
 * failure mode next/headers and next/navigation had. Server actions call
 * these purely for their cache-invalidation side effect, which isn't
 * observable from outside Next anyway, so a no-op spy is enough: tests can
 * assert *that* a path/tag was invalidated without needing a real cache.
 */
export const revalidatePath = vi.fn<(path: string, type?: "layout" | "page") => void>(() => {});
export const revalidateTag = vi.fn<(tag: string) => void>(() => {});
export const unstable_cache = vi.fn(
  <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
);
export const unstable_noStore = vi.fn(() => {});
