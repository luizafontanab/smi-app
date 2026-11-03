// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RevisionChanges, type RevisionSets } from "@/components/console/RevisionChanges";
import { parseRevisionPayload, revisionChanges } from "@/app/console/member-revision";

// Jas used to see only "submitted edits on {date}" before Approve.
const M = "11111111-1111-1111-1111-111111111111";
const sets: RevisionSets = {
  services: { all: [{ id: 3, name: "Laser cutting" }, { id: 7, name: "Welding" }], current: [3] },
  membershipTypes: { all: [], current: [] },
};
const mediaUrl = (p: string | null) => (p ? `https://cdn.test/${p}` : null);

function show(payload: Record<string, unknown>, current: Record<string, unknown>) {
  const parsed = parseRevisionPayload(payload, M);
  render(<RevisionChanges changes={revisionChanges(parsed.values, current)} parsed={parsed} sets={sets} mediaUrl={mediaUrl} />);
}

describe("RevisionChanges", () => {
  it("shows each changed field as now → proposed", () => {
    show({ website: "https://new.test", name: "Acme" }, { website: "https://old.test", name: "Acme" });
    const website = screen.getByRole("rowheader", { name: "Website" }).closest("tr")!;
    expect(within(website).getByText("https://old.test")).toBeInTheDocument();
    expect(within(website).getByText("https://new.test")).toBeInTheDocument();
    // unchanged fields aren't listed
    expect(screen.queryByRole("rowheader", { name: "Company name" })).not.toBeInTheDocument();
  });

  // Industries are Jas's alone (2 Nov): an old revision's industry fields are
  // never applied, so they aren't shown as changes or as "not applied" noise.
  it("never lists a revision's industries", () => {
    show({ website: "https://new.test", industry_id: 2, industry_ids: [2] }, { website: "https://old.test", industry_id: 1 });
    expect(screen.queryByRole("rowheader", { name: /industr/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows service changes by name", () => {
    show({ service_ids: [7] }, {});
    const row = screen.getByRole("rowheader", { name: "Services" }).closest("tr")!;
    expect(row).toHaveTextContent("Adds Welding");
    expect(row).toHaveTextContent("Removes Laser cutting");
  });

  it("warns about fields a member's form can't produce, which won't be applied", () => {
    show({ status: "active", paid_at: "2026-10-01" }, {});
    expect(screen.getByRole("note")).toHaveTextContent(/not\s+applied/);
    expect(screen.getByRole("note")).toHaveTextContent("status");
    expect(screen.getByRole("note")).toHaveTextContent("paid_at");
  });

  it("says when nothing would change", () => {
    show({ name: "Acme" }, { name: "Acme" });
    expect(screen.getByText(/Nothing in this submission differs/)).toBeInTheDocument();
  });
});
