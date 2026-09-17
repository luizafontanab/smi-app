import { describe, expect, it } from "vitest";
import { companyPageValuesFromForm, memberValuesFromForm, type MemberFormExisting } from "@/lib/member-form";

const existing: MemberFormExisting = {
  slug: "acme-fabrication",
  status: "active",
  social: { linkedin: "https://www.linkedin.com/company/acme", facebook: "https://facebook.com/acme" },
};

/** A form with every required field filled, so each test varies one thing. */
function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Acme Fabrication Ltd",
    slug: "acme-fabrication",
    status: "active",
    billing_mode: "card",
    description: "<p>We cut and fold.</p>",
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

const ok = (result: ReturnType<typeof memberValuesFromForm>) => {
  if ("error" in result) throw new Error(`expected values, got error: ${result.error}`);
  return result;
};

describe("memberValuesFromForm", () => {
  it("never emits generated or identity columns", () => {
    const { values } = ok(memberValuesFromForm(form(), existing));
    // search_tsv is GENERATED ALWAYS — Postgres rejects any write to it, and
    // db/types.ts types it `unknown` on Update so TypeScript cannot catch this.
    for (const key of ["search_tsv", "id", "created_at", "stripe_customer_id", "draft_submitted_at"]) {
      expect(Object.keys(values)).not.toContain(key);
    }
  });

  it("requires a company name", () => {
    expect(memberValuesFromForm(form({ name: "  " }), existing)).toEqual({ error: "Company name is required." });
  });

  it("falls back through the name to the stored slug rather than writing empty", () => {
    expect(ok(memberValuesFromForm(form({ slug: "New Slug Here" }), existing)).values.slug).toBe("new-slug-here");
    expect(ok(memberValuesFromForm(form({ slug: "" }), existing)).values.slug).toBe("acme-fabrication-ltd");
    // a name that slugifies to nothing leaves the stored slug untouched
    expect(ok(memberValuesFromForm(form({ slug: "", name: "!!!" }), existing)).values.slug).toBe("acme-fabrication");
  });

  it("rejects values the database CHECK and enum would refuse", () => {
    expect(memberValuesFromForm(form({ billing_mode: "paypal" }), existing))
      .toEqual({ error: "Billing mode must be card or invoice." });
    expect(memberValuesFromForm(form({ status: "bogus" }), existing))
      .toEqual({ error: "Unknown membership status." });
  });

  it("validates coordinates, since they drive the map embed", () => {
    expect(memberValuesFromForm(form({ lat: "91" }), existing)).toMatchObject({ error: /Latitude/ });
    expect(memberValuesFromForm(form({ lng: "-181" }), existing)).toMatchObject({ error: /Longitude/ });
    expect(memberValuesFromForm(form({ lat: "abc" }), existing)).toMatchObject({ error: /Latitude/ });
    expect(ok(memberValuesFromForm(form({ lat: "53.48", lng: "-2.24" }), existing)).values)
      .toMatchObject({ lat: 53.48, lng: -2.24 });
    expect(ok(memberValuesFromForm(form(), existing)).values).toMatchObject({ lat: null, lng: null });
  });

  it("validates the contact email and stores blanks as null", () => {
    expect(memberValuesFromForm(form({ contact_email: "not-an-email" }), existing))
      .toEqual({ error: "Contact email is not a valid address." });
    expect(ok(memberValuesFromForm(form(), existing)).values.contact_email).toBeNull();
  });

  it("stores empty text fields as null, not empty strings", () => {
    const { values } = ok(memberValuesFromForm(form({ address: "  ", phone: "" }), existing));
    expect(values).toMatchObject({ address: null, phone: null, website: null, video_url: null });
  });

  it("normalises paid_at to ISO and blank dates to null", () => {
    expect(ok(memberValuesFromForm(form({ paid_at: "2026-08-01T09:30" }), existing)).values.paid_at)
      .toBe(new Date("2026-08-01T09:30").toISOString());
    expect(ok(memberValuesFromForm(form(), existing)).values).toMatchObject({ paid_at: null, joined_at: null, comped_until: null });
  });

  it("merges socials from social_-prefixed fields, keeping untouched channels", () => {
    const { values } = ok(memberValuesFromForm(
      form({ social_linkedin: "https://www.linkedin.com/company/acme-new", social_facebook: "" }),
      existing,
    ));
    expect(values.social).toEqual({ linkedin: "https://www.linkedin.com/company/acme-new" });
  });

  it("rejects a malformed phone number", () => {
    expect(memberValuesFromForm(form({ phone: "call me" }), existing)).toMatchObject({ error: /Phone number/ });
    expect(ok(memberValuesFromForm(form({ phone: "0161 555 0100" }), existing)).values.phone).toBe("0161 555 0100");
  });

  it("sanitises the description on the way in", () => {
    const { values } = ok(memberValuesFromForm(form({ description: '<p onclick="x()">Hi</p><script>bad()</script>' }), existing));
    expect(values.description).toBe("<p>Hi</p>");
  });

  it("applies an uploaded image, and clears one only when asked", () => {
    expect(ok(memberValuesFromForm(form(), existing, { logo_path: "members/1/abc.png" })).values.logo_path)
      .toBe("members/1/abc.png");
    // no upload, no remove → the key is absent so the stored path survives
    expect(Object.keys(ok(memberValuesFromForm(form(), existing)).values)).not.toContain("logo_path");
    expect(ok(memberValuesFromForm(form({ remove_hero: "on" }), existing)).values.hero_path).toBeNull();
    // an upload wins over a stale remove checkbox
    expect(ok(memberValuesFromForm(form({ remove_logo: "on" }), existing, { logo_path: "members/1/new.png" })).values.logo_path)
      .toBe("members/1/new.png");
  });

  describe("the A17 activation gate", () => {
    const draft: MemberFormExisting = { ...existing, status: "draft" };

    it("refuses to activate a draft with no payment or comp on record", () => {
      expect(memberValuesFromForm(form({ status: "active" }), draft)).toMatchObject({ error: /payment or comp/ });
    });

    it("allows marking paid and activating in one save", () => {
      const result = ok(memberValuesFromForm(form({ status: "active", paid_at: "2026-08-01T09:30" }), draft));
      expect(result.activatingDraft).toBe(true);
      expect(memberValuesFromForm(form({ status: "active", comped_until: "2027-08-01" }), draft)).not.toHaveProperty("error");
    });

    it("does not gate a member who is already past draft", () => {
      const grace: MemberFormExisting = { ...existing, status: "grace" };
      expect(ok(memberValuesFromForm(form({ status: "active" }), grace)).activatingDraft).toBe(false);
      // clearing paid_at on a live member is a correction, not an activation
      expect(memberValuesFromForm(form({ status: "active", paid_at: "" }), existing)).not.toHaveProperty("error");
    });

    it("leaves other draft transitions alone", () => {
      expect(memberValuesFromForm(form({ status: "lapsed" }), draft)).not.toHaveProperty("error");
      expect(ok(memberValuesFromForm(form({ status: "draft" }), draft)).activatingDraft).toBe(false);
    });
  });
});

/**
 * The company-page half, shared verbatim by `/console/members/[id]` and
 * `/dashboard/profile`. The point of the split is that both pages post the same
 * field names into the same parser, so they cannot drift the way they had —
 * most visibly on the social inputs, where the console posted `social_linkedin`
 * and the member page posted `linkedin`, silently dropping every link a member
 * saved through the console parser.
 */
describe("companyPageValuesFromForm", () => {
  const shared = (overrides: Record<string, string> = {}) => {
    const fd = new FormData();
    const base: Record<string, string> = { name: "Acme Fabrication Ltd", slug: "acme-fabrication" };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
    return fd;
  };
  const okShared = (r: ReturnType<typeof companyPageValuesFromForm>) => {
    if ("error" in r) throw new Error(`expected values, got error: ${r.error}`);
    return r.values;
  };

  it("reads social links from the prefixed field name both pages now post", () => {
    const values = okShared(companyPageValuesFromForm(shared({ social_linkedin: "https://linkedin.com/company/new" }), existing));
    expect((values.social as Record<string, string>).linkedin).toBe("https://linkedin.com/company/new");
  });

  // The member page used to post a bare `linkedin`. Nothing reads that now, and
  // an absent prefixed field means "cleared" (mergeSocial deletes on empty) —
  // so a form that forgets these inputs wipes every link rather than keeping
  // them. Both pages render all six, which is what makes that safe.
  it("does not read a bare social key, and an absent field clears the stored link", () => {
    const values = okShared(companyPageValuesFromForm(shared({ linkedin: "https://linkedin.com/company/bare" }), existing));
    expect((values.social as Record<string, string>).linkedin).toBeUndefined();
    expect((values.social as Record<string, string>).facebook).toBeUndefined();
  });

  it("requires a company name", () => {
    const r = companyPageValuesFromForm(shared({ name: "" }), existing);
    expect(r).toEqual({ error: "Company name is required." });
  });

  it("falls back through the name to the stored slug rather than writing an empty one", () => {
    expect(okShared(companyPageValuesFromForm(shared({ slug: "" }), existing)).slug).toBe("acme-fabrication-ltd");
    expect(okShared(companyPageValuesFromForm(shared({ slug: "", name: "!!!" }), existing)).slug).toBe("acme-fabrication");
  });

  it("clears an image only when its remove box is ticked, and an upload always wins", () => {
    expect(okShared(companyPageValuesFromForm(shared({ remove_logo: "on" }), existing))).toMatchObject({ logo_path: null });
    expect(okShared(companyPageValuesFromForm(shared({ remove_logo: "on" }), existing, { logo_path: "members/m1/new.png" })))
      .toMatchObject({ logo_path: "members/m1/new.png" });
    expect(okShared(companyPageValuesFromForm(shared(), existing))).not.toHaveProperty("logo_path");
  });

  it("emits none of the membership fields — a member must never set those", () => {
    const values = okShared(companyPageValuesFromForm(
      shared({ status: "active", billing_mode: "invoice", paid_at: "2026-01-01T00:00", is_bundle_account: "on" }),
      existing,
    ));
    for (const key of ["status", "billing_mode", "paid_at", "comped_until", "joined_at", "grace_until", "is_bundle_account"]) {
      expect(values).not.toHaveProperty(key);
    }
  });

  it("validates contact email and phone the same way for both pages", () => {
    expect(companyPageValuesFromForm(shared({ contact_email: "nope" }), existing))
      .toEqual({ error: "Contact email is not a valid address." });
    expect(companyPageValuesFromForm(shared({ phone: "call me" }), existing)).toHaveProperty("error");
  });
});
