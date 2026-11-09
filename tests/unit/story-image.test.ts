import { describe, expect, it } from "vitest";
import { LOGO_BOX, LOGO_FIT, storyImage, storyImageFit } from "@/lib/story-image";

// Jas 28/10 (open items #6): the member's logo as a last-resort story picture,
// plus an admin switch to show it instead of a poor cover.
describe("storyImage", () => {
  const member = { logo_path: "members/acme.png" };
  const focus = { x: 0.2, y: 0.3, scale: 1.1 };

  it("shows the cover, with its crop, when there is one", () => {
    expect(storyImage({ cover_path: "stories/c.jpg", cover_focus: focus, member })).toEqual({ path: "stories/c.jpg", focus, logo: false });
  });

  it("falls back to the member's logo when there is no cover", () => {
    expect(storyImage({ cover_path: null, cover_focus: focus, member })).toEqual({ path: "members/acme.png", focus: null, logo: true });
  });

  it("shows the logo over a cover when the admin chose it", () => {
    expect(storyImage({ cover_path: "stories/c.jpg", cover_use_logo: true, member })).toEqual({ path: "members/acme.png", focus: null, logo: true });
  });

  it("keeps the cover when the switch is on but there is no logo to show", () => {
    expect(storyImage({ cover_path: "stories/c.jpg", cover_use_logo: true, member: { logo_path: null } })?.path).toBe("stories/c.jpg");
    expect(storyImage({ cover_path: "stories/c.jpg", cover_use_logo: true, member: null })?.path).toBe("stories/c.jpg");
  });

  it("is null with neither a cover nor a member logo", () => {
    expect(storyImage({ cover_path: null, member: null })).toBeNull();
    expect(storyImage({ cover_path: null, member: { logo_path: "" } })).toBeNull();
    expect(storyImage({ cover_path: null, cover_use_logo: true })).toBeNull();
  });

  // serviceDb reads (newsletter email, previews, console) get archived and
  // lapsed members back; the public site never shows them, so neither may this.
  it("never uses the logo of an archived or lapsed member", () => {
    const archived = { logo_path: "members/acme.png", status: "active", archived_at: "2026-10-01T00:00:00Z" };
    const lapsed = { logo_path: "members/acme.png", status: "lapsed", archived_at: null };
    for (const m of [archived, lapsed]) {
      expect(storyImage({ cover_path: null, member: m })).toBeNull();
      expect(storyImage({ cover_path: "stories/c.jpg", cover_use_logo: true, member: m })?.path).toBe("stories/c.jpg");
    }
  });

  it("uses the logo of a member in grace, and of one read without its status (publicDb has already gated it)", () => {
    expect(storyImage({ cover_path: null, member: { logo_path: "members/acme.png", status: "grace", archived_at: null } })?.logo).toBe(true);
    expect(storyImage({ cover_path: null, member })?.logo).toBe(true);
  });
});

describe("storyImageFit", () => {
  it("draws a logo whole on white, with no crop", () => {
    expect(storyImageFit({ logo: true, focus: null })).toEqual({ box: LOGO_BOX, img: LOGO_FIT, style: undefined });
    expect(storyImageFit({ logo: true, focus: null }, { logoFit: "object-contain p-6" }).img).toBe("object-contain p-6");
  });

  it("crops a cover to fill, at its focus", () => {
    const fit = storyImageFit({ logo: false, focus: { x: 0.2, y: 0.3, scale: 1 } });
    expect(fit).toEqual({ box: "bg-graphite/10", img: "object-cover", style: { objectPosition: "20% 30%" } });
    expect(storyImageFit(null, { coverBox: "" }).box).toBe("");
  });
});
