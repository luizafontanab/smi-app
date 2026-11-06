import { afterEach, describe, expect, it, vi } from "vitest";
import IndustryPage, { generateMetadata } from "@/app/(public)/industry/[slug]/page";

/**
 * /industry/[slug] behind the industries_public flag (/console/features):
 * off sends an old link to News before anything is read; on leaves the page
 * as it was.
 */

const { isFeatureEnabled, loadIndustryHub, industryBySlug, industries } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(async () => true),
  loadIndustryHub: vi.fn(async () => null),
  industryBySlug: vi.fn(async () => ({ id: 7, slug: "welding", name: "Welding" })),
  industries: vi.fn(async () => [{ slug: "welding", name: "Welding" }]),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/app/(public)/industry/[slug]/hub.data", () => ({ loadIndustryHub }));
vi.mock("@/lib/queries", () => ({ industryBySlug, industries }));

afterEach(() => {
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  loadIndustryHub.mockClear();
  industryBySlug.mockClear();
  industries.mockClear();
});

const props = { params: Promise.resolve({ slug: "welding" }), searchParams: Promise.resolve({}) } as unknown as PageProps<"/industry/[slug]">;

describe("industry page", () => {
  it("redirects to News while industries are hidden, reading nothing", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await expect(IndustryPage(props)).rejects.toThrow("NEXT_REDIRECT:/news");
    expect(isFeatureEnabled).toHaveBeenCalledWith("industries_public");
    expect(loadIndustryHub).not.toHaveBeenCalled();
    expect(industries).not.toHaveBeenCalled();
  });

  it("gives no industry metadata while hidden", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    expect(await generateMetadata(props)).toEqual({});
    expect(industryBySlug).not.toHaveBeenCalled();
  });

  it("serves the page as before while industries are public", async () => {
    // a null hub is "no such industry" — reaching notFound() proves the flag let it through
    await expect(IndustryPage(props)).rejects.toThrow(/NEXT_(NOT_FOUND|HTTP_ERROR_FALLBACK)/);
    expect(loadIndustryHub).toHaveBeenCalledWith("welding");
    expect((await generateMetadata(props)).title).toBe("Welding");
  });
});
