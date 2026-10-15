import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  breadcrumbLd,
  eventLd,
  localBusinessLd,
  newsArticleLd,
  organizationLd,
  stripTags,
  videoLd,
  webSiteLd,
} from "@/lib/jsonld";

/**
 * The builders are pure, but every one of them runs a value through compact(),
 * whose whole job is to drop absent fields rather than emit `null` — a
 * validator treats an explicit null as an error, so "field is missing" and
 * "field is null" are genuinely different outcomes. Each builder therefore gets
 * a populated case and a sparse case; the sparse ones are what actually guard
 * the contract.
 */

const SITE = "https://smi.test";

beforeEach(() => {
  // siteUrl() reads process.env at call time. Pinned here so abs() is
  // deterministic regardless of what .env.local holds on the machine running
  // the suite.
  vi.stubEnv("SITE_URL", SITE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("organizationLd", () => {
  it("names the site and points at its own origin", () => {
    expect(organizationLd()).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Sheet Metal Industries",
      url: SITE,
    });
  });

  it("follows SITE_URL rather than hard-coding a domain", () => {
    vi.stubEnv("SITE_URL", "https://elsewhere.example");
    expect(organizationLd().url).toBe("https://elsewhere.example");
  });
});

describe("webSiteLd", () => {
  it("declares a search action against the site's own /search", () => {
    const ld = webSiteLd() as {
      potentialAction: { target: { urlTemplate: string }; "query-input": string };
    };
    expect(ld.potentialAction.target.urlTemplate).toBe(`${SITE}/search?q={search_term_string}`);
    expect(ld.potentialAction["query-input"]).toBe("required name=search_term_string");
  });
});

describe("newsArticleLd", () => {
  const story = {
    slug: "new-press-brake",
    title: "New press brake",
    excerpt: "A short summary",
    published_at: "2026-08-12T09:00:00Z",
    coverUrl: "https://cdn.test/cover.jpg",
    memberName: "Acme Fabrications",
  };

  it("emits every field when the story is complete", () => {
    expect(newsArticleLd(story)).toEqual({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: "New press brake",
      description: "A short summary",
      datePublished: "2026-08-12T09:00:00Z",
      image: ["https://cdn.test/cover.jpg"],
      mainEntityOfPage: `${SITE}/news/new-press-brake`,
      author: { "@type": "Organization", name: "Acme Fabrications" },
      publisher: { "@type": "Organization", name: "Sheet Metal Industries", url: SITE },
    });
  });

  it("omits absent fields instead of emitting null", () => {
    const ld = newsArticleLd({
      slug: "bare",
      title: "Bare",
      excerpt: null,
      published_at: null,
      coverUrl: null,
      memberName: null,
    });
    expect(ld).not.toHaveProperty("description");
    expect(ld).not.toHaveProperty("datePublished");
    expect(ld).not.toHaveProperty("image");
    expect(Object.values(ld)).not.toContain(null);
  });

  it("attributes an unattached story to the site itself", () => {
    expect(newsArticleLd({ slug: "s", title: "S", memberName: null }).author).toEqual({
      "@type": "Organization",
      name: "Sheet Metal Industries",
    });
  });

  it("drops an empty-string excerpt, which compact treats as absent", () => {
    expect(newsArticleLd({ slug: "s", title: "S", excerpt: "" })).not.toHaveProperty("description");
  });
});

describe("eventLd", () => {
  it("combines date and time into one startDate when a time is on record", () => {
    const ld = eventLd({
      slug: "open-day",
      title: "Open day",
      starts_on: "2026-09-01",
      starts_time: "10:30",
    });
    expect(ld.startDate).toBe("2026-09-01T10:30");
  });

  it("falls back to a date-only startDate", () => {
    const ld = eventLd({
      slug: "open-day",
      title: "Open day",
      starts_on: "2026-09-01",
      starts_time: null,
    });
    expect(ld.startDate).toBe("2026-09-01");
  });

  it("expands a location string into a Place", () => {
    const ld = eventLd({
      slug: "e",
      title: "E",
      starts_on: "2026-09-01",
      location: "NEC Birmingham",
    });
    expect(ld.location).toEqual({
      "@type": "Place",
      name: "NEC Birmingham",
      address: "NEC Birmingham",
    });
  });

  it("strips HTML out of the description", () => {
    const ld = eventLd({
      slug: "e",
      title: "E",
      starts_on: "2026-09-01",
      description: "<p>Come and <strong>see</strong> us</p>",
    });
    expect(ld.description).toBe("Come and see us");
  });

  it("omits location, description, image, endDate and organizer when absent", () => {
    const ld = eventLd({
      slug: "e",
      title: "E",
      starts_on: "2026-09-01",
      description: null,
      ends_on: null,
      location: null,
      coverUrl: null,
      memberName: null,
    });
    expect(ld).not.toHaveProperty("location");
    expect(ld).not.toHaveProperty("description");
    expect(ld).not.toHaveProperty("image");
    expect(ld).not.toHaveProperty("endDate");
    expect(ld).not.toHaveProperty("organizer");
    expect(ld.url).toBe(`${SITE}/event/e`);
  });

  it("keeps endDate, image and organizer when they are present", () => {
    const ld = eventLd({
      slug: "e",
      title: "E",
      starts_on: "2026-09-01",
      ends_on: "2026-09-03",
      coverUrl: "https://cdn.test/e.jpg",
      memberName: "Acme Fabrications",
    });
    expect(ld.endDate).toBe("2026-09-03");
    expect(ld.image).toEqual(["https://cdn.test/e.jpg"]);
    expect(ld.organizer).toEqual({ "@type": "Organization", name: "Acme Fabrications" });
  });
});

describe("localBusinessLd", () => {
  it("emits geo only when both coordinates are present", () => {
    const geo = localBusinessLd({ slug: "acme", name: "Acme", lat: 52.48, lng: -1.9 }).geo;
    expect(geo).toEqual({ "@type": "GeoCoordinates", latitude: 52.48, longitude: -1.9 });
  });

  it.each([
    ["latitude only", 52.48, null],
    ["longitude only", null, -1.9],
    ["neither", null, null],
  ])("omits geo with %s", (_label, lat, lng) => {
    expect(localBusinessLd({ slug: "acme", name: "Acme", lat, lng })).not.toHaveProperty("geo");
  });

  it("treats a zero coordinate as real, not as missing", () => {
    // Null Island is a legitimate value; a `!lat` guard would drop it.
    expect(localBusinessLd({ slug: "acme", name: "Acme", lat: 0, lng: 0 }).geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 0,
      longitude: 0,
    });
  });

  it("gathers website and socials into sameAs", () => {
    const ld = localBusinessLd({
      slug: "acme",
      name: "Acme",
      website: "https://acme.test",
      socialUrls: ["https://linkedin.test/acme", "https://x.test/acme"],
    });
    expect(ld.sameAs).toEqual([
      "https://acme.test",
      "https://linkedin.test/acme",
      "https://x.test/acme",
    ]);
  });

  // Review 16 Oct: members.website is stored as typed.
  it("publishes the website in sameAs as an absolute URL, and leaves junk out", () => {
    expect(localBusinessLd({ slug: "acme", name: "Acme", website: "www.acme.co.uk" }).sameAs).toEqual(["https://www.acme.co.uk"]);
    expect(localBusinessLd({ slug: "acme", name: "Acme", website: "n/a" })).not.toHaveProperty("sameAs");
  });

  it("omits sameAs when there is neither a website nor a social URL", () => {
    expect(localBusinessLd({ slug: "acme", name: "Acme" })).not.toHaveProperty("sameAs");
    expect(
      localBusinessLd({ slug: "acme", name: "Acme", website: null, socialUrls: [] })
    ).not.toHaveProperty("sameAs");
  });

  it("builds sameAs from socials alone when there is no website", () => {
    expect(
      localBusinessLd({ slug: "acme", name: "Acme", website: null, socialUrls: ["https://x.test/acme"] })
        .sameAs
    ).toEqual(["https://x.test/acme"]);
  });

  it("points url at the SMI profile, not the member's own site", () => {
    const ld = localBusinessLd({ slug: "acme", name: "Acme", website: "https://acme.test" });
    expect(ld.url).toBe(`${SITE}/member/acme`);
  });

  it("strips HTML from the description and omits the optional rest", () => {
    const ld = localBusinessLd({
      slug: "acme",
      name: "Acme",
      description: "<p>We  bend <em>metal</em></p>",
      address: null,
      phone: null,
      logoUrl: null,
      industryName: null,
    });
    expect(ld.description).toBe("We bend metal");
    expect(ld).not.toHaveProperty("address");
    expect(ld).not.toHaveProperty("telephone");
    expect(ld).not.toHaveProperty("image");
    expect(ld).not.toHaveProperty("knowsAbout");
  });

  it("keeps address, phone, logo and category when present", () => {
    const ld = localBusinessLd({
      slug: "acme",
      name: "Acme",
      address: "1 Forge Lane, Birmingham",
      phone: "0121 555 0100",
      logoUrl: "https://cdn.test/logo.png",
      industryName: "Laser cutting",
    });
    expect(ld).toMatchObject({
      address: "1 Forge Lane, Birmingham",
      telephone: "0121 555 0100",
      image: "https://cdn.test/logo.png",
      knowsAbout: "Laser cutting",
    });
  });
});

describe("videoLd", () => {
  it("derives thumbnail and embed URLs from the YouTube id", () => {
    const ld = videoLd({
      slug: "brake-demo",
      title: "Brake demo",
      description: "<p>A demo</p>",
      published_at: "2026-08-01",
      youtubeId: "abc123",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    expect(ld).toMatchObject({
      name: "Brake demo",
      description: "A demo",
      uploadDate: "2026-08-01",
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc123",
      contentUrl: "https://www.youtube.com/watch?v=abc123",
      mainEntityOfPage: `${SITE}/video/brake-demo`,
    });
  });

  it("falls back to the title when there is no description", () => {
    // VideoObject.description is effectively required by validators, so this
    // fallback is deliberate rather than an omission.
    const ld = videoLd({ slug: "v", title: "Just a title", description: null, url: "https://v.test" });
    expect(ld.description).toBe("Just a title");
  });

  it("omits the YouTube-derived URLs when there is no id", () => {
    const ld = videoLd({
      slug: "v",
      title: "V",
      youtubeId: null,
      published_at: null,
      url: "https://v.test",
    });
    expect(ld).not.toHaveProperty("thumbnailUrl");
    expect(ld).not.toHaveProperty("embedUrl");
    expect(ld).not.toHaveProperty("uploadDate");
  });
});

describe("breadcrumbLd", () => {
  it("numbers positions from 1 and absolutises each path", () => {
    expect(
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "News", path: "/news" },
      ])
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "News", item: `${SITE}/news` },
      ],
    });
  });

  it("leaves an already-absolute URL alone", () => {
    const ld = breadcrumbLd([{ name: "External", path: "https://other.test/page" }]) as {
      itemListElement: { item: string }[];
    };
    expect(ld.itemListElement[0].item).toBe("https://other.test/page");
  });

  it("survives an empty trail", () => {
    expect(breadcrumbLd([])).toMatchObject({ itemListElement: [] });
  });
});

describe("stripTags", () => {
  it("removes markup and collapses the whitespace it leaves behind", () => {
    expect(stripTags("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
  });

  it("returns an empty string for markup with no text", () => {
    expect(stripTags("<p></p>")).toBe("");
  });

  it("leaves plain text untouched", () => {
    expect(stripTags("already plain")).toBe("already plain");
  });
});
