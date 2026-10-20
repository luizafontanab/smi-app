// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { StoryBoard, type BoardStory } from "@/app/console/stories/StoryBoard";

// The board's optimistic drop has to come back when the server call fails —
// by returning {ok:false} or by throwing (a DB error, or requireConsole's
// sign-in redirect once the session has expired).

const { moveStory, drag } = vi.hoisted(() => ({
  moveStory: vi.fn<(input: { id: string; to: string }) => Promise<{ ok: boolean; error?: string }>>(),
  drag: { end: null as ((e: DragEndEvent) => void) | null },
}));

vi.mock("@/app/console/actions", () => ({
  moveStory,
  decideStory: vi.fn(),
  pinStory: vi.fn(),
  setStoryStatus: vi.fn(),
}));

// Drag-and-drop can't be driven in jsdom (nothing is laid out), so capture the
// board's onDragEnd and call it as dnd-kit would on a drop.
vi.mock("@dnd-kit/core", async (orig) => ({
  ...(await orig<typeof import("@dnd-kit/core")>()),
  DndContext: ({ onDragEnd, children }: { onDragEnd: (e: DragEndEvent) => void; children: ReactNode }) => {
    drag.end = onDragEnd;
    return <>{children}</>;
  },
}));

const card: BoardStory = { id: "s1", title: "Laser cutter launch", status: "draft", source: "admin", scheduled_at: null, pinned_until: null };

const column = (heading: RegExp) => screen.getByRole("heading", { name: heading }).parentElement!;

async function dropOn(status: string) {
  await act(async () => {
    drag.end!({ active: { id: "s1" }, over: { id: status } } as unknown as DragEndEvent);
  });
}

describe("StoryBoard drop", () => {
  it("a move the server refuses goes back, with the reason", async () => {
    moveStory.mockResolvedValueOnce({ ok: false, error: "The story couldn't be moved — try again." });
    render(<StoryBoard stories={[card]} />);
    await dropOn("awaiting_approval");
    expect(within(column(/^Drafts/)).getByText("Laser cutter launch")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The story couldn't be moved");
  });

  it("a move that throws goes back too, instead of sitting in the new column unsaved", async () => {
    moveStory.mockRejectedValueOnce(new Error("NEXT_REDIRECT;/login"));
    render(<StoryBoard stories={[card]} />);
    await dropOn("awaiting_approval");
    expect(within(column(/^Drafts/)).getByText("Laser cutter launch")).toBeInTheDocument();
    expect(within(column(/^Ready to review/)).queryByText("Laser cutter launch")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("didn't save");
  });

  it("a move that succeeds stays", async () => {
    moveStory.mockResolvedValueOnce({ ok: true });
    render(<StoryBoard stories={[card]} />);
    await dropOn("awaiting_approval");
    expect(within(column(/^Ready to review/)).getByText("Laser cutter launch")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
