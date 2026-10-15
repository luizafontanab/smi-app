import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

// /go/ and /visit/ count a click on every GET — crawlers following story and
// advert links were inflating members' click numbers (review, 16 Oct).
describe("robots", () => {
  it("keeps crawlers out of both click-throughs", () => {
    const [rule] = [robots().rules].flat();
    expect(rule.disallow).toEqual(expect.arrayContaining(["/go/", "/visit/"]));
  });
});
