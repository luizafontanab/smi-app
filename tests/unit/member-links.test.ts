import { describe, expect, it } from "vitest";
import { memberLinks } from "@/lib/member-links";

const member = (over: Partial<Parameters<typeof memberLinks>[0]> = {}) => ({ id: "m1", website: null, phone: null, social: null, ...over });

// The profile's Links box replaces the header Website/Call buttons and the
// text-only Follow box (28 Oct): one ordered list, every click through /go.
describe("memberLinks", () => {
  it("orders website, phone, then socials in channel order", () => {
    const links = memberLinks(member({
      website: "www.acme.co.uk",
      phone: "01234 567890",
      social: { youtube: "@acme", linkedin: "company/acme-ltd", x: "acme" },
    }));
    expect(links.map((l) => l.key)).toEqual(["website", "phone", "linkedin", "x", "youtube"]);
  });

  it("routes every href through /go so clicks are still counted", () => {
    const links = memberLinks(member({ website: "https://acme.example", phone: "0123", social: { linkedin: "acme" } }));
    expect(links.map((l) => l.href)).toEqual([
      "/go/m1?kind=website",
      "/go/m1?kind=phone",
      "/go/m1?kind=social&platform=linkedin",
    ]);
  });

  it("shows the website as a bare domain, and opens it off-site", () => {
    const [site] = memberLinks(member({ website: "https://www.acme.co.uk/" }));
    expect(site).toMatchObject({ label: "Website", detail: "acme.co.uk", external: true, channel: null });
    expect(memberLinks(member({ website: "https://www.acme.co.uk/en/" }))[0].detail).toBe("acme.co.uk/en");
  });

  it("shows the phone number and keeps the call in the same tab", () => {
    const [phone] = memberLinks(member({ phone: "  01234 567890 " }));
    expect(phone).toMatchObject({ label: "Call", detail: "01234 567890", external: false });
  });

  it("leaves out a website that can't be a link and a blank phone", () => {
    expect(memberLinks(member({ website: "see LinkedIn", phone: "   " }))).toEqual([]);
  });

  it("keeps an unlinkable social value as text, with no href", () => {
    const [link] = memberLinks(member({ social: { linkedin: "javascript:alert(1)" } }));
    expect(link).toMatchObject({ key: "linkedin", href: null, detail: "javascript:alert(1)", channel: "linkedin" });
  });

  it("gives a social handle as the detail, and an unknown extra key no brand channel", () => {
    const links = memberLinks(member({ social: { instagram: "acmeuk", mastodon: "https://mastodon.social/@acme" } }));
    expect(links[0]).toMatchObject({ label: "Instagram", detail: "@acmeuk", channel: "instagram" });
    expect(links[1]).toMatchObject({ key: "mastodon", channel: null });
  });
});
