// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoForm } from "@/app/dashboard/video/new/VideoForm";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const noop = async () => {};
const props = {
  action: noop,
  uploadImage: async () => ({ error: "not in this test" }),
  industries: [{ id: 1, name: "Fabrication" }, { id: 2, name: "Laser cutting" }],
  member: { name: "Acme Metal", slug: "acme", logoUrl: null },
  defaultIndustryId: 2,
};
const edit = (industryId: number | null) => ({
  id: "v1", title: "Bending 101", url: "https://www.youtube.com/watch?v=abc123",
  description: "", thumbnailUrl: null, industryId,
});
const industrySelect = () => screen.getByLabelText("Industry") as HTMLSelectElement;

// The member's industry is a convenience for a first submission, not a rule
// about the row. Applying it in edit mode too meant a member who deliberately
// chose "— none —" had it silently replaced every time they resubmitted.
describe("VideoForm industry default", () => {
  it("starts a new video on the member's own industry", () => {
    render(<VideoForm {...props} />);
    expect(industrySelect().value).toBe("2");
  });

  it("keeps a deliberate none on edit instead of falling back to the member's", () => {
    render(<VideoForm {...props} initial={edit(null)} />);
    expect(industrySelect().value).toBe("");
  });

  it("keeps the saved industry on edit", () => {
    render(<VideoForm {...props} initial={edit(1)} />);
    expect(industrySelect().value).toBe("1");
  });

  it("falls back to none on a new video when the member has no industry either", () => {
    render(<VideoForm {...props} defaultIndustryId={null} />);
    expect(industrySelect().value).toBe("");
  });
});
