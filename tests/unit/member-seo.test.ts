import { describe, expect, it } from "vitest";
import { fallbackMemberDescription, memberMetadata, type MemberSeoInput } from "@/lib/member-seo";
import { SITE_CARD } from "@/lib/seo";

/**
 * Each case is a profile with something missing, because the incomplete ones are
 * where tags went missing before: no About text meant no meta description,
 * and no hero or logo meant a summary_large_image card with no image.
 */

const member = (over: Partial<MemberSeoInput> = {}): MemberSeoInput => ({
  name: "Acme Fabrication",
  description: "<p>Laser cutting &amp; folding since 1982.</p>",
  address: "Poole, Dorset",
  archived_at: null,
  industry: { name: "Fabrication" },
  services: [{ name: "Laser cutting" }, { name: "Welding" }],
  heroUrl: "https://cdn.test/hero.png",
  logoUrl: "https://cdn.test/logo.png",
  ...over,
});

const og = (m: ReturnType<typeof memberMetadata>) => m.openGraph as Record<string, unknown>;
const tw = (m: ReturnType<typeof memberMetadata>) => m.twitter as Record<string, unknown>;

describe("memberMetadata", () => {
  it("uses the member's own About text, plain, as the description", () => {
    const meta = memberMetadata(member(), "acme");
    expect(meta.description).toBe("Laser cutting & folding since 1982.");
    expect(og(meta).description).toBe(meta.description);
    expect(tw(meta).description).toBe(meta.description);
  });

  it.each([null, "", "<p> </p>"])("falls back to the structured fields when the About text is %j", (description) => {
    const meta = memberMetadata(member({ description }), "acme");
    expect(meta.description).toBe("Acme Fabrication — SMI member · Fabrication, Poole, Dorset. Laser cutting, Welding.");
    expect(og(meta).description).toBe(meta.description);
  });

  it("prefers the hero, then the logo, then the site card for the share image", () => {
    expect(og(memberMetadata(member(), "acme")).images).toEqual(["https://cdn.test/hero.png"]);
    expect(og(memberMetadata(member({ heroUrl: null }), "acme")).images).toEqual(["https://cdn.test/logo.png"]);
    const bare = memberMetadata(member({ heroUrl: null, logoUrl: null }), "acme");
    expect(og(bare).images).toEqual([SITE_CARD]);
    expect(tw(bare).images).toEqual([SITE_CARD]);
  });

  it("keeps the site name and locale the layout would otherwise lose to the shallow merge", () => {
    expect(og(memberMetadata(member(), "acme"))).toMatchObject({ siteName: "Sheet Metal Industries", locale: "en_GB", type: "profile", url: "/member/acme" });
  });

  it("canonicalises to the slug and marks only archived profiles noindex", () => {
    const live = memberMetadata(member(), "acme");
    expect(live.alternates).toEqual({ canonical: "/member/acme" });
    expect(live.robots).toBeUndefined();
    expect(memberMetadata(member({ archived_at: "2026-09-23T00:00:00Z" }), "acme").robots).toEqual({ index: false, follow: false });
  });

  it("describes nothing for a missing member", () => {
    expect(memberMetadata(null, "gone")).toEqual({ title: "Member" });
  });
});

describe("fallbackMemberDescription", () => {
  it("omits absent parts rather than leaving stray punctuation", () => {
    expect(fallbackMemberDescription({ name: "Solo Ltd", address: null, industry: null, services: [] })).toBe("Solo Ltd — SMI member.");
  });

  it("stays within a search snippet's length", () => {
    const services = Array.from({ length: 30 }, (_, i) => ({ name: `Service ${i}` }));
    const text = fallbackMemberDescription({ name: "Busy Ltd", address: "Leeds", industry: null, services });
    expect(text.length).toBeLessThanOrEqual(161);
    expect(text.endsWith("…")).toBe(true);
  });
});
