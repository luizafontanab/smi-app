import { describe, expect, it } from "vitest";
import { parseIssueItems } from "@/lib/newsletter-picker";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseIssueItems", () => {
  it("keeps the posted order, stories and videos mixed", () => {
    expect(parseIssueItems([`video:${B}`, `story:${A}`, `story:${B}`])).toEqual([
      { kind: "video", id: B },
      { kind: "story", id: A },
      { kind: "story", id: B },
    ]);
  });

  it("drops anything malformed rather than failing the save", () => {
    expect(parseIssueItems([`event:${A}`, "story:not-a-uuid", "story:", A, `story:${A}`])).toEqual([{ kind: "story", id: A }]);
  });

  it("keeps a repeat in its first place only", () => {
    expect(parseIssueItems([`story:${A}`, `video:${A}`, `story:${A}`])).toEqual([
      { kind: "story", id: A },
      { kind: "video", id: A },
    ]);
  });
});
