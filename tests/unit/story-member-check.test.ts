import { describe, expect, it } from "vitest";
import { storyMemberShortfall, type ExportStory, type LiveStory, type StoryMemberLink } from "../../scripts/lib/story-member-check";

/**
 * verify-import's story ↔ member check. It compared an exact count, which
 * stopped being true the first time an admin re-tagged a story or a migration
 * added a missing primary — a permanent false ✗ on a healthy production
 * database. Pinned here: extra tags are fine, a dropped export tag is not, the
 * primary must be among the tags, and a member missing from the database is
 * its own finding.
 */
const byWp = new Map([[1, "m1"], [2, "m2"], [3, "m3"]]);
const story = (over: Partial<ExportStory> = {}): ExportStory => ({ slug: "s", wp_member_id: 1, member_wp_ids: [1, 2], ...over });
const live = (over: Partial<LiveStory> = {}): LiveStory => ({ id: "st1", slug: "s", member_id: "m1", ...over });
const tags = (...members: string[]): StoryMemberLink[] => members.map((member_id) => ({ story_id: "st1", member_id }));

describe("storyMemberShortfall", () => {
  it("passes a story tagged exactly as the export had it", () => {
    expect(storyMemberShortfall([story()], [live()], tags("m1", "m2"), byWp)).toEqual({
      checked: 1, untagged: [], primaryMissing: [], absentMembers: [],
    });
  });

  it("passes a story an admin has since tagged with another member — the old exact count failed here", () => {
    const r = storyMemberShortfall([story()], [live()], tags("m1", "m2", "m3"), byWp);
    expect(r.untagged).toEqual([]);
    expect(r.primaryMissing).toEqual([]);
  });

  it("passes when the export left the primary out of member_wp_ids and the migration added it", () => {
    const r = storyMemberShortfall([story({ member_wp_ids: [2] })], [live()], tags("m1", "m2"), byWp);
    expect(r).toMatchObject({ untagged: [], primaryMissing: [] });
  });

  it("flags a story that lost a member the export tagged it with", () => {
    const r = storyMemberShortfall([story()], [live()], tags("m1", "m3"), byWp);
    expect(r.untagged).toEqual([{ slug: "s", missingWpIds: [2] }]);
  });

  it("flags a story whose primary isn't among its tags", () => {
    const r = storyMemberShortfall([story({ wp_member_id: null, member_wp_ids: [2] })], [live({ member_id: "m3" })], tags("m2"), byWp);
    expect(r.primaryMissing).toEqual(["s"]);
    expect(r.untagged).toEqual([]);
  });

  it("counts an export member missing from the database separately, not as a tagging fault", () => {
    const r = storyMemberShortfall([story({ member_wp_ids: [1, 99] })], [live()], tags("m1"), byWp);
    expect(r.untagged).toEqual([]);
    expect(r.absentMembers).toEqual([99]);
  });

  it("skips export stories that aren't in the database — the row counts report those", () => {
    const r = storyMemberShortfall([story({ slug: "gone" }), story()], [live()], tags("m1", "m2"), byWp);
    expect(r.checked).toBe(1);
    expect(r.untagged).toEqual([]);
  });

  it("treats a story with no tags at all as missing every export member", () => {
    const r = storyMemberShortfall([story()], [live()], [], byWp);
    expect(r.untagged).toEqual([{ slug: "s", missingWpIds: [1, 2] }]);
    expect(r.primaryMissing).toEqual(["s"]);
  });
});
