// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubmissionList } from "@/components/dashboard/SubmissionList";
import type { PendingSubmission, SubmissionKind, SubmissionStatus } from "@/lib/submissions";

// The server actions are only ever passed to <form action>, never invoked here.
vi.mock("@/app/dashboard/actions", () => ({
  withdrawStory: vi.fn(),
  withdrawVideo: vi.fn(),
  withdrawEvent: vi.fn(),
  withdrawMachine: vi.fn(),
  requestContentChange: vi.fn(),
}));

const item = (over: Partial<PendingSubmission> & { kind: SubmissionKind; status: SubmissionStatus }): PendingSubmission => ({
  id: "x1",
  title: "A thing",
  rejected_reason: null,
  created_at: "2026-09-01T10:00:00Z",
  editHref: `/dashboard/${over.kind}/x1/edit`,
  publicHref: null,
  ...over,
});

describe("SubmissionList kind labels", () => {
  // A member's story publishes as news, and featured_machines is "equipment"
  // everywhere member-facing (fix list: show the type next to the title).
  it("labels each content type the way the member sees it", () => {
    render(<SubmissionList items={[
      item({ kind: "story", status: "awaiting_approval", id: "s1" }),
      item({ kind: "video", status: "awaiting_approval", id: "v1" }),
      item({ kind: "event", status: "awaiting_approval", id: "e1" }),
      item({ kind: "machine", status: "awaiting_approval", id: "m1" }),
    ]} />);

    expect(screen.getByText("News")).toBeInTheDocument();
    expect(screen.getByText("Video")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
  });
});

describe("SubmissionList per-status actions", () => {
  it("offers edit and withdraw only while the member may still change it", () => {
    render(<SubmissionList items={[item({ kind: "story", status: "awaiting_approval" })]} />);
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("offers edit on a sent-back item, with the reason shown", () => {
    render(<SubmissionList items={[item({ kind: "story", status: "rejected", rejected_reason: "Needs a cover" })]} />);
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText(/Needs a cover/)).toBeInTheDocument();
  });

  // The invariant that matters: published content is not the member's to edit
  // or withdraw — the server refuses both — so the UI must not offer them.
  it("never offers edit or withdraw on published content", () => {
    render(<SubmissionList items={[item({ kind: "story", status: "published", publicHref: "/news/a-thing" })]} />);

    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/news/a-thing");
    expect(screen.getByText("Request a change")).toBeInTheDocument();
  });

  it("offers no change-request form on equipment, which has no public page", () => {
    render(<SubmissionList items={[item({ kind: "machine", status: "published" })]} />);
    expect(screen.queryByRole("link", { name: "View" })).not.toBeInTheDocument();
    // Still requestable — it is published, it just has nowhere to link to.
    expect(screen.getByText("Request a change")).toBeInTheDocument();
  });

  it("shows a withdrawn item read-only", () => {
    render(<SubmissionList items={[item({ kind: "video", status: "withdrawn" })]} />);
    expect(screen.getByText("withdrawn")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByText("Request a change")).not.toBeInTheDocument();
  });

  it("carries the current tab into the change request so it returns there", () => {
    const { container } = render(
      <SubmissionList items={[item({ kind: "story", status: "published" })]} filter="published" />,
    );
    expect(container.querySelector('input[name="filter"]')).toHaveValue("published");
  });
});
