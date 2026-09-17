import { vi } from "vitest";

/**
 * Aliased over "next/headers" in vitest.config.ts. `cookieStore` and
 * `requestHeaders` are shared, mutable fakes — seed them before calling the
 * code under test, and reset in afterEach so one test's cookies/headers
 * don't leak into the next:
 *
 *   import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";
 *   afterEach(resetNextHeadersMocks);
 *   it("...", async () => {
 *     cookieStore.set("smi-theme", "grid");
 *     expect(await siteVariant()).toBe("grid");
 *   });
 */

export type MockCookie = { name: string; value: string };

class MockCookieStore {
  private store = new Map<string, string>();
  get(name: string): MockCookie | undefined {
    return this.store.has(name) ? { name, value: this.store.get(name)! } : undefined;
  }
  getAll(): MockCookie[] {
    return [...this.store.entries()].map(([name, value]) => ({ name, value }));
  }
  has(name: string): boolean {
    return this.store.has(name);
  }
  set(name: string, value: string): this {
    this.store.set(name, value);
    return this;
  }
  delete(name: string): this {
    this.store.delete(name);
    return this;
  }
  __reset(): void {
    this.store.clear();
  }
}

export const cookieStore = new MockCookieStore();
/** Real Headers — the codebase only ever calls .get() on this, which Node's built-in already implements correctly. */
export const requestHeaders = new Headers();

export function resetNextHeadersMocks() {
  cookieStore.__reset();
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key);
}

export const cookies = vi.fn(async () => cookieStore);
export const headers = vi.fn(async () => requestHeaders);
export const draftMode = vi.fn(async () => ({ isEnabled: false }));
