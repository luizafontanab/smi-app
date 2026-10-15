import { describe, expect, it } from "vitest";
import { MAX_MEMBER_INDUSTRIES, memberIndustriesError } from "@/lib/member-services";

// Review finding 16 Oct: a member's industry set had no cap — a crafted POST
// could file them under every /industry/* page at once.
describe("memberIndustriesError", () => {
  it("allows up to the cap", () => {
    expect(MAX_MEMBER_INDUSTRIES).toBe(3);
    expect(memberIndustriesError([])).toBeNull();
    expect(memberIndustriesError([1, 2, 3])).toBeNull();
    expect(memberIndustriesError([1, 1, 2, 2, 3])).toBeNull(); // duplicates are one choice
  });

  it("refuses past the cap", () => {
    expect(memberIndustriesError([1, 2, 3, 4])).toBe("Choose up to 3 industries.");
  });

  it("lets a member keep, or trim, a larger set they already hold — never grow it", () => {
    expect(memberIndustriesError([1, 2, 3, 4], [1, 2, 3, 4, 5])).toBeNull();
    expect(memberIndustriesError([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBeNull();
    expect(memberIndustriesError([1, 2, 3, 4, 6], [1, 2, 3, 4, 5])).toBe("Choose up to 3 industries.");
  });
});
