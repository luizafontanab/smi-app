// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SOCIAL_CONFIRM_FORM, SOCIAL_TOOL_FORM, SocialConfirmForm, SocialPostFields, SocialToolForm } from "@/components/console/SocialPostFields";
import type { SocialPanel } from "@/lib/social-post";
import type { ChannelRecord } from "@/lib/social-confirm";

vi.mock("@/lib/db/server", () => ({ mediaUrl: (p: string | null) => (p ? `https://media.test/${p}` : null) }));

const caps = { per_day: 3, delay_minutes: 30 };
const confirm = vi.fn(async () => {});
const tool = vi.fn(async () => {});
type State = SocialPanel["channels"][number]["state"];
const channel = (id: string, label: string, state: State, network: string | null, record: Partial<ChannelRecord> | null = null) => ({
  label, network, confirmedBy: null, state, fingerprint: `fp-${id}`,
  record: record && { channel_id: id, skip: false, posted_at: null, confirmed_text: null, confirmed_image: null, confirmed_at: null, ...record },
  post: { channelId: id, text: `Acme wins.\n\nhttps://smi.test/news/a\n\n${id}:acme`, imagePath: "c.jpg" },
});
const panel = (o: Partial<SocialPanel> = {}): SocialPanel => ({
  networks: "known",
  channels: [
    channel("li", "LinkedIn", "handed", "linkedin", { handed_at: "2026-11-05T14:02:00Z", due_at: "2026-11-05T17:00:00Z" }),
    channel("x", "X", "waiting", "twitter"),
  ],
  lines: ["LinkedIn: scheduled in Buffer for 17:00", "X: waiting — Schedule or Publish now"],
  ...o,
});
type Extra = Partial<Pick<Parameters<typeof SocialPostFields>[0], "confirmed" | "mode" | "written" | "drafted" | "tools">>;
const fields = (p: SocialPanel | null, extra: Extra = {}) => (
  <>
    <form aria-label="editor">
      <input name="title" aria-label="Title" defaultValue="Acme" />
      <SocialPostFields item={null} fallback="Acme wins." fallbackName="summary" caps={caps} panel={p} confirmable
        tools={{ writer: true, buffer: true }} {...extra} />
      <button type="submit">Save</button>
    </form>
    <SocialConfirmForm action={confirm} id="s1" />
    <SocialToolForm action={tool} id="s1" />
  </>
);
const row = (label: string) => screen.getByText(label, { selector: "span" }).closest("li")!;

describe("SocialPostFields", () => {
  it("shows each channel's exact text and status, with Schedule / Publish now only where it's waiting", () => {
    render(fields(panel()));

    expect(screen.getByText(/x:acme$/)).toBeTruthy();
    expect(screen.getByText("X: waiting — Schedule or Publish now")).toBeTruthy();
    expect(within(row("X")).getByRole("button", { name: "Schedule" })).toBeTruthy();
    expect(within(row("X")).getByRole("button", { name: "Publish now" })).toBeTruthy();
    // with Buffer already: nothing to schedule, and no tools (changing it means saving, which takes it back out)
    expect(within(row("LinkedIn")).queryByRole("button")).toBeNull();
  });

  it("offers Schedule all / Publish all now only when more than one channel waits", () => {
    render(fields(panel({ channels: [channel("li", "LinkedIn", "waiting", "linkedin"), channel("x", "X", "waiting", "twitter")], lines: ["", ""] })));
    expect(screen.getByRole("button", { name: "Schedule all (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish all now (2)" })).toBeTruthy();
  });

  it("keeps every button out of the editor form, so Enter in a field presses Save", () => {
    render(fields(panel()));
    const editor = screen.getByRole("form", { name: "editor" }) as HTMLFormElement;

    const submitters = Array.from(editor.elements).filter((e) => e instanceof HTMLButtonElement && e.type === "submit");
    expect((submitters[0] as HTMLButtonElement).textContent).toBe("Save");
    const x = row("X");
    expect((within(x).getByRole("button", { name: "Schedule" }) as HTMLButtonElement).form?.id).toBe(SOCIAL_CONFIRM_FORM);
    expect((within(x).getByRole("button", { name: "Write with Claude" }) as HTMLButtonElement).form?.id).toBe(SOCIAL_TOOL_FORM);
    expect((within(x).getByRole("button", { name: "Send draft to Buffer" }) as HTMLButtonElement).form?.id).toBe(SOCIAL_TOOL_FORM);
  });

  it("sends each channel's fingerprint as shown to both small forms, and the button says which action and channel", () => {
    const { container } = render(fields(panel()));
    for (const id of [SOCIAL_CONFIRM_FORM, SOCIAL_TOOL_FORM]) {
      const data = new FormData(container.querySelector(`#${id}`) as HTMLFormElement);
      expect(data.get("id")).toBe("s1");
      expect(data.get("social_seen:x")).toBe("fp-x");
      expect(data.get("title")).toBeNull();
    }
    const x = row("X");
    expect(within(x).getByRole("button", { name: "Schedule" }).getAttribute("value")).toBe("schedule:x");
    expect(within(x).getByRole("button", { name: "Publish now" }).getAttribute("value")).toBe("now:x");
    expect(within(x).getByRole("button", { name: "Write with Claude" }).getAttribute("name")).toBe("write_channel");
  });

  it("gives each channel a wording box in the editor form, sized to its network, saying who wrote it", () => {
    render(fields(panel({
      channels: [
        channel("li", "LinkedIn", "waiting", "linkedin", { lead_text: "Acme Engineering took the top prize.", lead_ai: true }),
        channel("x", "X", "waiting", "twitter"),
      ],
      lines: ["", ""],
    })));
    const li = screen.getByLabelText("Wording for LinkedIn") as HTMLTextAreaElement;
    expect(li.name).toBe("social_lead:li");
    expect(li.value).toBe("Acme Engineering took the top prize.");
    expect(li.maxLength).toBe(1500);
    expect(li.form?.getAttribute("aria-label")).toBe("editor");
    expect(screen.getByText(/Written by Claude/)).toBeTruthy();
    expect((screen.getByLabelText("Wording for X") as HTMLTextAreaElement).maxLength).toBe(200);
  });

  it("says when the Buffer draft no longer matches the post", () => {
    render(fields(panel({
      channels: [channel("x", "X", "waiting", "twitter", { draft_post_id: "d1", draft_text: "an older text", draft_image: "c.jpg", draft_at: "2026-11-05T14:00:00Z" })],
      lines: [""],
    })));
    expect(screen.getByText(/Draft in Buffer since/)).toBeTruthy();
    expect(screen.getByText(/The post has changed since/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send draft again" })).toBeTruthy();
  });

  it("turns the tools off, and says why, without Claude's key or Buffer's network", () => {
    render(fields(panel({ channels: [channel("x", "X", "waiting", null)], lines: [""] }), { tools: { writer: false, buffer: false } }));
    expect((screen.getByRole("button", { name: "Write with Claude" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send draft to Buffer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs the Anthropic key/)).toBeTruthy();
  });

  it("shows the one-line summary, and what just happened", () => {
    const { unmount } = render(fields(panel(), { confirmed: "2", mode: "now" }));
    expect(screen.getByText("Social post: 1 with Buffer, 1 waiting.")).toBeTruthy();
    expect(screen.getByText(/Publish now for 2 channels/)).toBeTruthy();
    unmount();
    render(fields(panel(), { written: "x", drafted: "li" }));
    expect(screen.getByText(/Claude wrote the wording for X/)).toBeTruthy();
    expect(screen.getByText(/Draft sent to Buffer for LinkedIn/)).toBeTruthy();
  });

  it("turns the buttons off with a Save first hint once the form has unsaved changes", () => {
    render(fields(panel()));
    const button = within(row("X")).getByRole("button", { name: "Schedule" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.input(screen.getByLabelText("Wording for X"), { target: { value: "Edited" } });

    expect(button.disabled).toBe(true);
    expect((within(row("X")).getByRole("button", { name: "Write with Claude" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Save first").length).toBeGreaterThan(0);
  });

  it("says when no channels are connected, and offers nothing to schedule", () => {
    render(fields(panel({ channels: [], lines: [] })));
    expect(screen.getByText("No social channels connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Schedule|Publish/ })).toBeNull();
  });

  it("keeps scheduling off while Buffer can't say which network each channel is", () => {
    render(fields(panel({ networks: "failed" })));
    expect((within(row("X")).getByRole("button", { name: "Schedule" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/scheduling is off/);
  });

  it("asks for a save before a new item can be previewed", () => {
    render(fields(null));
    expect(screen.getByText(/Save it first/)).toBeTruthy();
  });
});
