// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BufferChannels } from "@/app/console/stories/BufferChannels";
import type { ChannelDetail, ChannelDetails } from "@/lib/adapters/social";

vi.mock("@/app/console/actions", () => ({ saveSocialChannels: vi.fn() }));

const LI: ChannelDetail = {
  id: "li-1", service: "linkedin", name: "Sheet Metal Industries", disconnected: false, locked: false,
  profileUrl: "https://www.linkedin.com/company/smi",
};
const X: ChannelDetail = { id: "x-1", service: "twitter", name: "SheetMetalInd", disconnected: true, locked: false, profileUrl: null };
const FB: ChannelDetail = { id: "fb-1", service: "facebook", name: "SMI", disconnected: false, locked: false, profileUrl: null };

const known = (...list: ChannelDetail[]): ChannelDetails => ({ kind: "known", channels: new Map(list.map((c) => [c.id, c])) });

function show(over: Partial<Parameters<typeof BufferChannels>[0]> = {}) {
  return render(
    <BufferChannels
      channels={{ channelIds: ["li-1", "x-1"], organizationId: "org-1", legacyProfileIds: [] }}
      details={known(LI, X, FB)}
      view="board"
      editing={false}
      saved={false}
      saveFailed={false}
      {...over}
    />,
  );
}

const row = (id: string) => screen.getByText(id).closest("li")!;

describe("Buffer channels on /console/stories", () => {
  it("reads as saved once ids are stored: names and details, no editable fields", () => {
    show({ saved: true });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(within(row("li-1")).getByText("Sheet Metal Industries")).toBeTruthy();
    expect(within(row("li-1")).getByText("LinkedIn")).toBeTruthy();
    expect(within(row("li-1")).getByText(/Connected/)).toBeTruthy();
    expect(within(row("li-1")).getByRole("link", { name: /View on LinkedIn/ })).toHaveAttribute("href", LI.profileUrl);
    expect(within(row("x-1")).getByText(/Disconnected: reconnect it in Buffer/)).toBeTruthy();
    expect(screen.getByText("org-1")).toBeTruthy();
    expect(screen.getByText(/Also in Buffer, not posted to: Facebook · SMI/)).toBeTruthy();
  });

  it("Edit opens the form on the same tab, at the section", () => {
    show({ view: "list" });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/console/stories?view=list&channels=edit#buffer-channels");
  });

  it("in edit mode shows the form with the saved values, the tab, and a way back", () => {
    const { container } = show({ editing: true });

    expect(screen.getByRole("textbox", { name: /Channel IDs/ })).toHaveValue("li-1\nx-1");
    expect(screen.getByRole("textbox", { name: /Organisation ID/ })).toHaveValue("org-1");
    expect(container.querySelector('input[name="view"]')).toHaveValue("board");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/console/stories#buffer-channels");
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("shows the form straight away when nothing is saved yet, with nothing to cancel back to", () => {
    show({ channels: { channelIds: [], legacyProfileIds: [] } });
    expect(screen.getByRole("textbox", { name: /Channel IDs/ })).toHaveValue("");
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
  });

  it("flags a saved id Buffer doesn't have, because posts to it will fail", () => {
    show({ details: known(LI) });
    expect(within(row("x-1")).getByText("Unknown channel")).toBeTruthy();
    expect(within(row("x-1")).getByText(/Not in this Buffer organisation/)).toBeTruthy();
  });

  it("says why there are no details, and still lists the saved ids", () => {
    for (const [details, text] of [
      [{ kind: "unknown", reason: "no-key" }, /no Buffer key/],
      [{ kind: "unknown", reason: "no-organisation" }, /Add the organisation id/],
      [{ kind: "failed" }, /Couldn't load channel details/],
    ] as const) {
      const { unmount } = show({ details });
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByText("li-1")).toBeTruthy();
      // Without a lookup, an id isn't called unknown or missing from Buffer.
      expect(screen.queryByText("Unknown channel")).toBeNull();
      expect(screen.queryByText(/Not in this Buffer organisation/)).toBeNull();
      unmount();
    }
  });

  it("says a failed save failed, and keeps the form", () => {
    show({ editing: true, saveFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the channels");
    expect(screen.getByRole("textbox", { name: /Channel IDs/ })).toBeTruthy();
  });
});
