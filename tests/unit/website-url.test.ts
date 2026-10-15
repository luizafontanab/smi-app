import { describe, expect, it } from "vitest";
import { websiteUrl } from "@/lib/website-url";

// members.website is stored as typed. Without a scheme it was a relative URL,
// so /go/[memberId] redirected to /go/www.foo.co.uk → the homepage (review, 16 Oct).
describe("websiteUrl", () => {
  it.each([
    ["www.foo.co.uk", "https://www.foo.co.uk"],
    ["foo.com/about-us", "https://foo.com/about-us"],
    ["  https://acme.example  ", "https://acme.example"],
    ["https://acme.example/", "https://acme.example"],
    ["HTTPS://Acme.Example/Path?x=1", "https://acme.example/Path?x=1"],
    ["http://old-site.co.uk", "http://old-site.co.uk"],
    ["//cdn-less.example/x", "https://cdn-less.example/x"],
    ["foo.com:8080/x", "https://foo.com:8080/x"],
    ["bücher.de", "https://xn--bcher-kva.de"],
  ])("makes %j a link: %s", (raw, expected) => {
    expect(websiteUrl(raw)).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["a script URL", "javascript:alert(1)"],
    ["a mailto", "mailto:hi@acme.example"],
    ["ftp", "ftp://acme.example"],
    ["words", "see our LinkedIn"],
    ["n/a", "n/a"],
    ["a bare word", "acme"],
    ["localhost", "localhost:3000"],
    ["an IP literal", "192.168.0.1"],
    ["a path on our own site", "/member/acme"],
    ["credentials in the URL", "https://bank.example@evil.example"],
    ["a scheme with no host", "https://"],
  ])("refuses %s", (_label, raw) => {
    expect(websiteUrl(raw)).toBeNull();
  });
});
