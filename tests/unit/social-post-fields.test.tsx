// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SocialPostFields } from "@/components/console/SocialPostFields";
import type { SocialPanel } from "@/lib/social-post";

vi.mock("@/lib/db/server", () => ({ mediaUrl: (p: string | null) => (p ? `https://media.test/${p}` : null) }));

const caps = { per_day: 3, delay_minutes: 30 };
const confirm = vi.fn(async () => {});
const channel = (id: string, label: string, state: "waiting" | "confirmed" | "posted" | "skipped") => ({
  label, network: null, confirmedBy: null, record: null, state,
  post: { channelId: id, text: `Acme wins.\n\nhttps://smi.test/news/a\n\n${id}:acme`, imagePath: "c.jpg" },
});
const panel = (o: Partial<SocialPanel> = {}): SocialPanel => ({
  networks: "known",
  channels: [channel("li", "LinkedIn", "confirmed"), channel("x", "X", "waiting")],
  lines: ["LinkedIn: confirmed by Jas 5 Nov 14:02, posts 15:00", "X: waiting for confirmation"],
  ...o,
});
const fields = (p: SocialPanel | null) => (
  <form>
    <SocialPostFields item={null} fallback="Acme wins." fallbackName="summary" caps={caps} panel={p} confirmAction={confirm} />
  </form>
);

describe("SocialPostFields", () => {
  it("shows each channel's exact text and status, with Confirm only where it's waiting, plus Confirm all", () => {
    render(fields(panel()));

    expect(screen.getByText(/x:acme$/)).toBeTruthy();
    expect(screen.getByText("X: waiting for confirmation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm LinkedIn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm X" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm all (1)" })).toBeTruthy();
  });

  it("turns Confirm off with a Save first hint once the form has unsaved changes", () => {
    render(fields(panel()));
    const button = screen.getByRole("button", { name: "Confirm X" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.input(screen.getByLabelText("Lead-in"), { target: { value: "Edited" } });

    expect(button.disabled).toBe(true);
    expect(screen.getAllByText("Save first").length).toBeGreaterThan(0);
  });

  it("says when no channels are connected, and offers nothing to confirm", () => {
    render(fields(panel({ channels: [], lines: [] })));
    expect(screen.getByText("No social channels connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });

  it("keeps Confirm off while Buffer can't say which network each channel is", () => {
    render(fields(panel({ networks: "failed" })));
    expect((screen.getByRole("button", { name: "Confirm X" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/confirming is off/);
  });

  it("asks for a save before a new item can be previewed", () => {
    render(fields(null));
    expect(screen.getByText(/Save it first/)).toBeTruthy();
  });
});
