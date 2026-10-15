import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

async function csp(): Promise<string> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const header = rules.flatMap((r) => r.headers).find(({ key }) => key === "Content-Security-Policy");
  if (!header) throw new Error("no Content-Security-Policy header configured");
  return header.value;
}

const directive = (policy: string, name: string) =>
  policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("Content-Security-Policy", () => {
  // Video cards, the home hero and og:image fall back to YouTube stills; with
  // i.ytimg.com missing the browser blocked every one of them (GAPS A8.5).
  it("lets YouTube's still images load", async () => {
    expect(directive(await csp(), "img-src").split(/\s+/)).toContain("https://i.ytimg.com");
  });

  it("keeps img-src to named hosts — no scheme-wide or bare wildcard", async () => {
    const sources = directive(await csp(), "img-src").split(/\s+/).slice(1);
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("http:");
  });

  it("still frames only the YouTube players for video", async () => {
    expect(directive(await csp(), "frame-src")).toContain("https://www.youtube-nocookie.com");
  });

  // 6 Oct: embedded Checkout on /dashboard/pay/invoice — Stripe.js, its
  // frames (incl. 3-D Secure) and its API, and nothing broader.
  it("lets Stripe's embedded Checkout load, frame and call home", async () => {
    const policy = await csp();
    expect(directive(policy, "script-src").split(/\s+/)).toContain("https://js.stripe.com");
    expect(directive(policy, "frame-src").split(/\s+/)).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://hooks.stripe.com"]));
    expect(directive(policy, "connect-src").split(/\s+/)).toContain("https://api.stripe.com");
  });
});
