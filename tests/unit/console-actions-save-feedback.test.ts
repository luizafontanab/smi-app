import { afterEach, describe, expect, it, vi } from "vitest";
import { saveEvent, saveMachine, saveStory, saveVideo } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

/**
 * Fix list 73: the four console content editors saved silently — no banner, no
 * redirect marker, nothing. The convention everywhere else in the console is a
 * `?saved=1` redirect that the page renders as a "Saved." status banner, so
 * these assert the marker is actually on the redirect the action performs.
 *
 * The blank-required-field cases used to be a bare `return`, which left the
 * operator staring at an unchanged form with no idea whether anything happened.
 * They now redirect with a readable `?error=`.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  enqueue.mockReset().mockResolvedValue(undefined);
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("save actions signal a successful save with ?saved=1", () => {
  it("saveStory marks the redirect back to the story it just wrote", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1" })) });

    await expect(saveStory(form({ id: "s1", title: "Updated" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s1\?saved=1$/);
  });

  it("saveStory marks it on a newly created story too", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s2" })) });

    await expect(saveStory(form({ title: "Brand new" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s2\?saved=1$/);
  });

  it("saveVideo marks the redirect back to the video", async () => {
    db({ videos: () => queryBuilder(dbOk({ id: "v1" })) });

    await expect(saveVideo(form({ id: "v1", title: "T", url: "https://youtu.be/x" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/videos\/v1\?saved=1$/);
  });

  it("saveEvent marks the redirect back to the event", async () => {
    db({ events: () => queryBuilder(dbOk({ id: "e1" })) });

    await expect(saveEvent(form({ id: "e1", title: "T", starts_on: "2026-09-01" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/events\/e1\?saved=1$/);
  });

  it("saveMachine marks the redirect back to the machine", async () => {
    db({ featured_machines: () => queryBuilder(dbOk({ id: "mc1" })) });

    await expect(saveMachine(form({ id: "mc1", name: "Laser cutter", member_id: "m1" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/machines\/mc1\?saved=1$/);
  });
});

describe("save actions say why a required field stopped them", () => {
  it("saveStory redirects with a readable error for a blank title rather than returning silently", async () => {
    const from = db({});

    await expect(saveStory(form({ id: "s1", title: "  " })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?error=Give%20the%20story%20a%20title%20before%20saving.");
    expect(from).not.toHaveBeenCalled();
  });

  it("saveStory sends a blank-title new story back to the new-story editor", async () => {
    db({});

    await expect(saveStory(form({ title: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/new\?error=/);
  });

  it("saveVideo redirects with an error when the title or link is missing", async () => {
    const from = db({});

    await expect(saveVideo(form({ id: "v1", title: "T", url: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/videos\/v1\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("saveEvent redirects with an error when the start date is missing", async () => {
    const from = db({});

    await expect(saveEvent(form({ id: "e1", title: "T", starts_on: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/events\/e1\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("saveMachine redirects with an error when the seller is missing", async () => {
    const from = db({});

    await expect(saveMachine(form({ id: "mc1", name: "Laser cutter", member_id: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/machines\/mc1\?error=/);
    expect(from).not.toHaveBeenCalled();
  });
});
