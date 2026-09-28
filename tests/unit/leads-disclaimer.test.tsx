// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadsDisclaimer } from "@/components/leads/LeadsDisclaimer";

// USE-CASES gap 24: both lead-gen panels must say plainly these are not
// vetted sales leads, and that the data is what people published themselves.
describe("LeadsDisclaimer", () => {
  it("says the prospects are not vetted sales leads, sourced from what they published", () => {
    render(<LeadsDisclaimer />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/not vetted sales leads/i);
    expect(note).toHaveTextContent(/published themselves/i);
  });
});
