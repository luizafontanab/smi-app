import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth";

// /preview/story/[id] — the order of its two checks (review finding 16 Oct).
// The page's own module graph is stubbed down to the two reads it makes: who
// is looking, and the story.
const { currentUser, storyForPreview } = vi.hoisted(() => ({
  currentUser: vi.fn<() => Promise<CurrentUser | null>>(),
  storyForPreview: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentUser }));
vi.mock("@/lib/queries", () => ({ storyForPreview }));
vi.mock("@/lib/story-page", () => ({ loadStoryPageData: vi.fn(async () => ({ members: [] })) }));
vi.mock("@/components/story/StoryPageView", () => ({ StoryPageView: () => null }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import StoryPreviewPage from "@/app/(public)/preview/story/[id]/page";

const ID = "6f1c2a8e-3b4d-4c5e-9f6a-7b8c9d0e1f2a";
const owner: CurrentUser = { userId: "u1", email: "m@acme.example", role: "member", memberId: "mem1", displayName: "Acme" };
const admin: CurrentUser = { userId: "a", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas" };
const other: CurrentUser = { ...owner, userId: "u2", memberId: "mem2" };

const props = () => ({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }) as unknown as PageProps<"/preview/story/[id]">;
const story = (over: Record<string, unknown> = {}) => ({
  id: ID, slug: "acme-wins", status: "awaiting_approval", member_id: "mem1", source: "member", member_draft: false,
  cover_path: null, categories: [], social_posts: {}, ...over,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("story preview page", () => {
  it("sends the owner of a story that has since published to the live page, not a 404", async () => {
    currentUser.mockResolvedValue(owner);
    storyForPreview.mockResolvedValue(story({ status: "published" }));
    await expect(StoryPreviewPage(props())).rejects.toThrow("NEXT_REDIRECT:/news/acme-wins");
  });

  it("does the same for an admin", async () => {
    currentUser.mockResolvedValue(admin);
    storyForPreview.mockResolvedValue(story({ status: "published", source: "admin", member_id: null }));
    await expect(StoryPreviewPage(props())).rejects.toThrow("NEXT_REDIRECT:/news/acme-wins");
  });

  it("anyone else still gets the same 404 as an unknown id", async () => {
    currentUser.mockResolvedValue(other);
    storyForPreview.mockResolvedValue(story({ status: "published" }));
    await expect(StoryPreviewPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an unpublished story the owner may preview still renders", async () => {
    currentUser.mockResolvedValue(owner);
    storyForPreview.mockResolvedValue(story());
    await expect(StoryPreviewPage(props())).resolves.toBeTruthy();
  });
});
