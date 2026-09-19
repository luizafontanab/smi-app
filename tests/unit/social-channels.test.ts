import { describe, expect, it } from "vitest";
import { DEFAULT_SOCIAL_CHANNELS, readSocialChannels } from "@/lib/social-channels";

describe("readSocialChannels", () => {
  it("returns empty lists for a settings row that has never been edited", () => {
    expect(readSocialChannels(null)).toEqual({ channelIds: [], organizationId: undefined, legacyProfileIds: [] });
    expect(DEFAULT_SOCIAL_CHANNELS.channelIds).toEqual([]);
  });

  it("reads channel ids and the optional organisation id", () => {
    const read = readSocialChannels({ channelIds: ["c-1", "c-2"], organizationId: "org-1" });

    expect(read.channelIds).toEqual(["c-1", "c-2"]);
    expect(read.organizationId).toBe("org-1");
  });

  it("surfaces pre-migration v1 profile ids separately, never as channel ids", () => {
    // Coercing them would post to the wrong account, or fail with a MutationError
    // the operator can't explain — so the console can say what they are instead.
    const read = readSocialChannels({ profileIds: ["profile-1"] });

    expect(read.channelIds).toEqual([]);
    expect(read.legacyProfileIds).toEqual(["profile-1"]);
  });

  it("keeps channel ids when both shapes are present", () => {
    const read = readSocialChannels({ channelIds: ["c-1"], profileIds: ["profile-1"] });

    expect(read.channelIds).toEqual(["c-1"]);
    expect(read.legacyProfileIds).toEqual(["profile-1"]);
  });

  it("drops blanks and non-strings rather than sending them to Buffer", () => {
    const read = readSocialChannels({ channelIds: ["c-1", "", "   ", 7, null] });

    expect(read.channelIds).toEqual(["c-1"]);
  });

  it("treats an empty organisation id as absent", () => {
    expect(readSocialChannels({ organizationId: "" }).organizationId).toBeUndefined();
  });
});
