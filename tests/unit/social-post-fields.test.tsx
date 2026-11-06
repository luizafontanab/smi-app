// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SOCIAL_CONFIRM_FORM, SocialConfirmForm, SocialPostFields } from "@/components/console/SocialPostFields";
import type { SocialPanel } from "@/lib/social-post";

vi.mock("@/lib/db/server", () => ({ mediaUrl: (p: string | null) => (p ? `https://media.test/${p}` : null) }));

const caps = { per_day: 3, delay_minutes: 30 };
const confirm = vi.fn(async () => {});
const channel = (id: string, label: string, state: "waiting" | "confirmed" | "posted" | "skipped") => ({
  label, network: null, confirmedBy: null, record: null, state, fingerprint: `fp-${id}`,
  post: { channelId: id, text: `Acme wins.\n\nhttps://smi.test/news/a\n\n${id}:acme`, imagePath: "c.jpg" },
});
const panel = (o: Partial<SocialPanel> = {}): SocialPanel => ({
  networks: "known",
  channels: [channel("li", "LinkedIn", "confirmed"), channel("x", "X", "waiting")],
  lines: ["LinkedIn: confirmed by Jas 5 Nov 14:02, posts 15:00", "X: waiting for confirmation"],
  ...o,
});
const fields = (p: SocialPanel | null, extra: { confirmed?: string } = {}) => (
  <>
    <form aria-label="editor">
      <input name="title" aria-label="Title" defaultValue="Acme" />
      <SocialPostFields item={null} fallback="Acme wins." fallbackName="summary" caps={caps} panel={p} confirmable {...extra} />
      <button type="submit">Save</button>
    </form>
    <SocialConfirmForm action={confirm} id="s1" />
  </>
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

  it("keeps Confirm out of the editor form, so Enter in a field presses Save, not Confirm", () => {
    render(fields(panel()));
    const editor = screen.getByRole("form", { name: "editor" }) as HTMLFormElement;
    const confirmX = screen.getByRole("button", { name: "Confirm X" }) as HTMLButtonElement;

    // the editor's first submit button — the one implicit submission uses — is Save
    const submitters = Array.from(editor.elements).filter((e) => e instanceof HTMLButtonElement && e.type === "submit");
    expect((submitters[0] as HTMLButtonElement).textContent).toBe("Save");
    expect(confirmX.form?.id).toBe(SOCIAL_CONFIRM_FORM);
  });

  it("sends each channel's fingerprint as shown with Confirm, in the confirm form", () => {
    const { container } = render(fields(panel()));
    const confirmForm = container.querySelector(`#${SOCIAL_CONFIRM_FORM}`) as HTMLFormElement;
    const data = new FormData(confirmForm);

    expect(data.get("id")).toBe("s1");
    expect(data.get("social_seen:x")).toBe("fp-x");
    expect(data.get("social_seen:li")).toBe("fp-li");
    expect(data.get("title")).toBeNull();
  });

  it("shows the one-line summary, and the confirmed banner after a Confirm", () => {
    render(fields(panel(), { confirmed: "2" }));
    expect(screen.getByText("Social post: 1 confirmed, 1 waiting for confirmation.")).toBeTruthy();
    expect(screen.getByText("Social post confirmed for 2 channels.")).toBeTruthy();
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
