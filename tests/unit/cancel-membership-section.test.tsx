// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CancelMembershipSection } from "@/app/console/members/[id]/CancelMembershipSection";
import type { MemberStatus } from "@/lib/membership";

/** The console member page's Cancel membership section: which action it offers (#90, #92). */
afterEach(() => cleanup());

const noop = async () => {};
const card = { id: "m1", status: "active" as MemberStatus, billing_mode: "card", cancel_requested_at: null as string | null };
const show = (member: typeof card) => render(<CancelMembershipSection member={member} cancel={noop} undo={noop} />);

describe("CancelMembershipSection", () => {
  it("offers Undo cancellation, not Cancel membership, while a cancel is pending", () => {
    show({ ...card, cancel_requested_at: "2026-11-01T10:00:00Z" });
    expect(screen.getByText(/Cancellation scheduled on 1 Nov 2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo cancellation" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Yes, undo this cancellation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel membership" })).toBeNull();
  });

  it("offers Cancel membership, and no undo, when nothing is pending", () => {
    show(card);
    expect(screen.getByRole("button", { name: "Cancel membership" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo cancellation" })).toBeNull();
  });

  it("offers no undo to an invoice-billing member", () => {
    show({ ...card, billing_mode: "invoice", cancel_requested_at: "2026-11-01T10:00:00Z" });
    expect(screen.queryByRole("button", { name: "Undo cancellation" })).toBeNull();
  });
});
