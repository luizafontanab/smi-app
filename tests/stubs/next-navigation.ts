import { vi } from "vitest";

/**
 * Aliased over "next/navigation" in vitest.config.ts. redirect()/notFound()
 * normally throw a special digest that Next's rendering machinery catches;
 * outside that machinery the throw would just look like a crash, so these
 * throw an identifiable Error instead — assert on it directly:
 *
 *   await expect(requireConsole()).rejects.toThrow("NEXT_REDIRECT:/login?next=/console");
 */

export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export const redirect = vi.fn((url: string): never => {
  throw new RedirectSignal(url);
});

export const permanentRedirect = vi.fn((url: string): never => {
  throw new RedirectSignal(url);
});

export const notFound = vi.fn((): never => {
  throw new NotFoundSignal();
});

export const useRouter = vi.fn(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));

export const usePathname = vi.fn(() => "/");
export const useSearchParams = vi.fn(() => new URLSearchParams());
export const useParams = vi.fn(() => ({}));
