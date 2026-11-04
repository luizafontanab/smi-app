import { describe, expect, it, vi, type Mock } from "vitest";
import { INTAKE_MESSAGES as M, resubmit, save, submit, type IntakeDeps } from "@/lib/content-intake";
import { MEMBER_CHANGED_ERROR } from "@/lib/member-content";
import { YOUTUBE_ONLY_ERROR } from "@/lib/youtube";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";

/**
 * Submission intake through its three operations — submit, resubmit and save —
 * with fake upload, geocode and notify adapters and the Supabase fakes. Written
 * from the plan (submission-intake D2, D3, D6, D10, D11), not the code.
 *
 * Each content table answers a read with the row under test, an insert with
 * `insert`, and an update with `write` — so a test fails on what was written,
 * never on the order the module happened to query in.
 */

type Builder = ReturnType<typeof queryBuilder>;
type Spy = Mock<(...args: unknown[]) => unknown>;
const spy = (b: Builder, method: string) => b[method] as Spy;
const called = (b: Builder, method: string) => spy(b, method).mock.calls.length > 0;

type TableOpts = { row?: Record<string, unknown> | null; insert?: DbResult; write?: DbResult };

function contentTable(o: TableOpts) {
  const builders: Builder[] = [];
  const factory = () => {
    const b: Builder = queryBuilder(() => {
      if (called(b, "insert")) return o.insert ?? dbOk({ id: "new1" });
      if (called(b, "update") || called(b, "delete")) return o.write ?? dbOk([{ id: "x" }]);
      return dbOk(o.row ?? null);
    });
    builders.push(b);
    return b;
  };
  return { factory, builders };
}

const TABLES = ["stories", "videos", "events"] as const;
type Table = (typeof TABLES)[number];

function setup(o: Partial<Record<Table, TableOpts>> & { rpc?: () => Promise<DbResult> } = {}) {
  const tables = Object.fromEntries(TABLES.map((t) => [t, contentTable(o[t] ?? {})])) as Record<Table, ReturnType<typeof contentTable>>;
  const side: Record<string, Builder[]> = {};
  const keep = (name: string) => () => {
    const b = queryBuilder(dbOk(null));
    (side[name] ??= []).push(b);
    return b;
  };
  const db = mockDb({
    from: fromByTable({
      stories: tables.stories.factory, videos: tables.videos.factory, events: tables.events.factory,
      story_categories: keep("story_categories"),
      // rescheduleSocialPush's read of pending posts: none, so it stops there.
      jobs: keep("jobs"),
    }),
    rpc: o.rpc,
  });
  const store = vi.fn<IntakeDeps["upload"]["store"]>(async () => ({ path: null }));
  const remove = vi.fn<IntakeDeps["upload"]["remove"]>(async () => {});
  const removeIfUnused = vi.fn<IntakeDeps["upload"]["removeIfUnused"]>(async () => {});
  const geocode = vi.fn<IntakeDeps["geocode"]>(async () => null);
  const notify = vi.fn<IntakeDeps["notify"]>(async () => {});
  const deps: IntakeDeps = { db: asDb(db), upload: { store, remove, removeIfUnused }, geocode, notify };

  const ops = (t: Table, method: "insert" | "update") =>
    tables[t].builders.filter((b) => called(b, method)).map((b) => ({
      values: spy(b, method).mock.calls[0]?.[0] as Record<string, unknown>,
      eq: spy(b, "eq").mock.calls,
    }));
  const inserts = (t: Table) => ops(t, "insert");
  const updates = (t: Table) => ops(t, "update");
  const nothingWritten = () => {
    for (const t of TABLES) {
      expect(inserts(t)).toEqual([]);
      expect(updates(t)).toEqual([]);
    }
  };
  const sideInserts = (name: string) => (side[name] ?? []).flatMap((b) => spy(b, "insert").mock.calls.map(([r]) => r));
  return { deps, db, store, remove, removeIfUnused, geocode, notify, inserts, updates, nothingWritten, sideInserts };
}

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}

const MEMBER = { userId: "u1", memberId: "mem1" };
const ADMIN = { userId: "admin1" };
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const OPENED = "2026-11-03T09:00:00.123456+00:00";

/** A member-written row the member may edit, as the resubmit read returns it. */
const own = (o: Record<string, unknown> = {}) => ({
  id: "x1", status: "awaiting_approval", member_id: "mem1", source: "member", updated_at: OPENED, ...o,
});

/* ================================================================== video */

describe("video", () => {
  describe("submit", () => {
    it("lands awaiting approval as the member's own, untagged, and tells the console", async () => {
      const h = setup({ videos: { insert: dbOk({ id: "v9" }) } });
      h.store.mockResolvedValue({ path: "videos/t.jpg" });
      const res = await submit(h.deps, "video", form({ title: " Bending ", url: YT, description: "<p>Hi</p><script>x</script>", industry_id: "5", member_id: "mem2" }), MEMBER);

      expect(res).toEqual({ ok: true, id: "v9", draft: false });
      expect(h.inserts("videos")[0].values).toEqual(expect.objectContaining({
        title: "Bending", url: YT, description: "<p>Hi</p>", status: "awaiting_approval", source: "member",
        member_id: "mem1", submitted_by: "u1", industry_id: null, thumbnail_path: "videos/t.jpg",
        slug: expect.stringMatching(/^bending-[0-9a-z]+$/),
      }));
      expect(h.store).toHaveBeenCalledWith(expect.any(FormData), "thumbnail", "videos", expect.anything());
      expect(h.notify).toHaveBeenCalledWith({
        kind: "video_submitted", memberId: "mem1", payload: { video_id: "v9" }, message: "Submitted a video for approval: “Bending”.",
      });
    });

    it.each([
      ["no title", { title: " ", url: YT }, M.video.required],
      ["no link", { title: "t", url: "" }, M.video.required],
      ["a link that isn't YouTube", { title: "t", url: "https://vimeo.com/1" }, YOUTUBE_ONLY_ERROR],
    ])("%s: says why, before uploading or writing anything", async (_label, fields, error) => {
      const h = setup();
      expect(await submit(h.deps, "video", form(fields), MEMBER)).toEqual({ ok: false, code: "invalid", error });
      expect(h.store).not.toHaveBeenCalled();
      h.nothingWritten();
    });

    it("an upload problem is said on the form, and nothing is written", async () => {
      const h = setup();
      h.store.mockResolvedValue({ error: "Image too large (8MB max)" });
      expect(await submit(h.deps, "video", form({ title: "t", url: YT }), MEMBER)).toEqual({ ok: false, code: "upload", error: "Image too large (8MB max)" });
      h.nothingWritten();
    });

    it("a failed insert removes the thumbnail it uploaded and tells nobody", async () => {
      const h = setup({ videos: { insert: dbError("boom") } });
      h.store.mockResolvedValue({ path: "videos/t.jpg" });
      expect(await submit(h.deps, "video", form({ title: "t", url: YT }), MEMBER)).toEqual({ ok: false, code: "failed", error: M.submitFailed });
      expect(h.remove).toHaveBeenCalledWith("videos/t.jpg");
      expect(h.notify).not.toHaveBeenCalled();
    });
  });

  describe("resubmit", () => {
    it("writes the edit conditional on the state and version it read, clears the reason, keeps Jas's industry", async () => {
      const h = setup({ videos: { row: own({ status: "rejected" }) } });
      const res = await resubmit(h.deps, "video", "x1", form({ title: "New", url: YT, version: OPENED, industry_id: "5" }), MEMBER);

      expect(res).toEqual({ ok: true, id: "x1", draft: false });
      const [w] = h.updates("videos");
      expect(w.values).toEqual(expect.objectContaining({ title: "New", url: YT, status: "awaiting_approval", rejected_reason: null, updated_at: expect.any(String) }));
      expect(w.values).not.toHaveProperty("industry_id");
      expect(w.values).not.toHaveProperty("thumbnail_path");
      expect(w.eq).toEqual(expect.arrayContaining([
        ["id", "x1"], ["member_id", "mem1"], ["source", "member"], ["status", "rejected"], ["updated_at", OPENED],
      ]));
      expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
        kind: "video_submitted", payload: { video_id: "x1" }, message: "Resubmitted their video “New” after changes.",
      }));
    });

    // The race this closes (D6): Jas approved while the form sat open.
    it("a form opened before the desk acted is refused as changed, before any upload", async () => {
      const h = setup({ videos: { row: own({ updated_at: "2026-11-03T10:30:00+00:00" }) } });
      expect(await resubmit(h.deps, "video", "x1", form({ title: "t", url: YT, version: OPENED }), MEMBER))
        .toEqual({ ok: false, code: "changed", error: MEMBER_CHANGED_ERROR.video });
      expect(h.store).not.toHaveBeenCalled();
      h.nothingWritten();
    });

    it("a video that went Live is changed; someone else's, or the desk's, is not found", async () => {
      for (const [row, code] of [[own({ status: "published" }), "changed"], [own({ member_id: "mem2" }), "not_found"], [own({ source: "manual" }), "not_found"], [null, "not_found"]] as const) {
        const h = setup({ videos: { row } });
        expect(await resubmit(h.deps, "video", "x1", form({ title: "t", url: YT }), MEMBER)).toEqual(expect.objectContaining({ ok: false, code }));
        h.nothingWritten();
      }
    });

    it("zero rows on the write: changed, and the new thumbnail is removed", async () => {
      const h = setup({ videos: { row: own(), write: dbOk([]) } });
      h.store.mockResolvedValue({ path: "videos/new.jpg" });
      expect(await resubmit(h.deps, "video", "x1", form({ title: "t", url: YT }), MEMBER))
        .toEqual({ ok: false, code: "changed", error: MEMBER_CHANGED_ERROR.video });
      expect(h.remove).toHaveBeenCalledWith("videos/new.jpg");
      expect(h.notify).not.toHaveBeenCalled();
    });

    it("a failed write: failed, and the new thumbnail is removed", async () => {
      const h = setup({ videos: { row: own(), write: dbError("boom") } });
      h.store.mockResolvedValue({ path: "videos/new.jpg" });
      expect(await resubmit(h.deps, "video", "x1", form({ title: "t", url: YT }), MEMBER))
        .toEqual({ ok: false, code: "failed", error: M.resubmitFailed });
      expect(h.remove).toHaveBeenCalledWith("videos/new.jpg");
    });

    it("blank fields say why, as on submit", async () => {
      const h = setup({ videos: { row: own() } });
      expect(await resubmit(h.deps, "video", "x1", form({ title: "t", url: "" }), MEMBER)).toEqual({ ok: false, code: "invalid", error: M.video.required });
    });
  });

  describe("save (console)", () => {
    it("creates a desk draft with the admin-only fields", async () => {
      const h = setup({ videos: { insert: dbOk({ id: "v2" }) } });
      const res = await save(h.deps, "video", null, form({ title: "T", url: YT, member_id: "m7", industry_id: "4" }), ADMIN);
      expect(res).toEqual({ ok: true, id: "v2" });
      expect(h.inserts("videos")[0].values).toEqual(expect.objectContaining({
        status: "draft", source: "manual", submitted_by: "admin1", member_id: "m7", industry_id: 4,
      }));
      expect(h.notify).not.toHaveBeenCalled();
    });

    it("updates an existing video, and a blank industry clears it", async () => {
      const h = setup();
      expect(await save(h.deps, "video", "v1", form({ title: "T", url: YT, industry_id: "" }), ADMIN)).toEqual({ ok: true, id: "v1" });
      const [w] = h.updates("videos");
      expect(w.values).toEqual(expect.objectContaining({ title: "T", industry_id: null, member_id: null }));
      expect(w.eq).toContainEqual(["id", "v1"]);
    });

    it("the same wording as the member form for a missing link (D6)", async () => {
      const h = setup();
      expect(await save(h.deps, "video", "v1", form({ title: "T", url: "" }), ADMIN)).toEqual({ ok: false, code: "invalid", error: M.video.required });
    });

    it("a bad social post time is refused before the upload", async () => {
      const h = setup();
      const res = await save(h.deps, "video", "v1", form({ title: "T", url: YT, social_at: "not a time" }), ADMIN);
      expect(res).toEqual(expect.objectContaining({ ok: false, code: "invalid" }));
      expect(h.store).not.toHaveBeenCalled();
    });

    // D11: an insert failure used to crash on data!.id; an update failure was silent.
    it.each([
      ["create", null, { insert: dbError("boom") }],
      ["update", "v1", { write: dbError("boom") }],
    ] as const)("a failed %s says so and removes the new thumbnail", async (_label, id, t) => {
      const h = setup({ videos: t });
      h.store.mockResolvedValue({ path: "videos/new.jpg" });
      expect(await save(h.deps, "video", id, form({ title: "T", url: YT }), ADMIN)).toEqual({ ok: false, code: "failed", error: M.saveFailed("video") });
      expect(h.remove).toHaveBeenCalledWith("videos/new.jpg");
    });
  });
});

/* ================================================================== event */

describe("event", () => {
  const base = { title: "Open day", starts_on: "2026-12-01" };

  describe("submit", () => {
    it("lands awaiting approval with a recognised type, untagged, and tells the console", async () => {
      const h = setup({ events: { insert: dbOk({ id: "e9" }) } });
      const res = await submit(h.deps, "event", form({ ...base, type: "webinar", starts_time: "10:00", link: "https://x.example", industry_id: "5" }), MEMBER);
      expect(res).toEqual({ ok: true, id: "e9", draft: false });
      expect(h.inserts("events")[0].values).toEqual(expect.objectContaining({
        title: "Open day", starts_on: "2026-12-01", starts_time: "10:00", ends_on: null, link: "https://x.example",
        type: "webinar", status: "awaiting_approval", source: "member", member_id: "mem1", industry_id: null,
      }));
      expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
        kind: "event_submitted", payload: { event_id: "e9" }, message: "Submitted an event for approval: “Open day”.",
      }));
    });

    it("an unrecognised type is stored as none", async () => {
      const h = setup();
      await submit(h.deps, "event", form({ ...base, type: "bogus" }), MEMBER);
      expect(h.inserts("events")[0].values).toEqual(expect.objectContaining({ type: null }));
    });

    // D6: a blank title used to return silently; the start date was only checked by the browser.
    it.each([
      ["no title", { title: " ", starts_on: "2026-12-01" }],
      ["no start date", { title: "t", starts_on: "" }],
    ])("%s: says why, before uploading or writing", async (_label, fields) => {
      const h = setup();
      expect(await submit(h.deps, "event", form(fields), MEMBER)).toEqual({ ok: false, code: "invalid", error: M.event.required });
      expect(h.store).not.toHaveBeenCalled();
      h.nothingWritten();
    });

    it("geocodes a location into the map pin; no location, no lookup", async () => {
      const h = setup();
      h.geocode.mockResolvedValue({ lat: 51.5, lng: -0.1 });
      await submit(h.deps, "event", form({ ...base, location: "London" }), MEMBER);
      expect(h.inserts("events")[0].values).toEqual(expect.objectContaining({ location: "London", lat: 51.5, lng: -0.1 }));

      const h2 = setup();
      await submit(h2.deps, "event", form(base), MEMBER);
      expect(h2.geocode).not.toHaveBeenCalled();
      expect(h2.inserts("events")[0].values).toEqual(expect.objectContaining({ location: null, lat: null, lng: null }));
    });
  });

  describe("resubmit", () => {
    const pinned = own({ status: "rejected", location: "Leeds", lat: 53.8, lng: -1.5 });

    it("an unchanged location keeps the pin without a lookup", async () => {
      const h = setup({ events: { row: pinned } });
      expect(await resubmit(h.deps, "event", "x1", form({ ...base, location: "Leeds" }), MEMBER)).toEqual({ ok: true, id: "x1", draft: false });
      expect(h.geocode).not.toHaveBeenCalled();
      expect(h.updates("events")[0].values).toEqual(expect.objectContaining({ location: "Leeds", lat: 53.8, lng: -1.5, status: "awaiting_approval", rejected_reason: null }));
    });

    it("a changed location that fails to geocode keeps the old pin", async () => {
      const h = setup({ events: { row: pinned } });
      await resubmit(h.deps, "event", "x1", form({ ...base, location: "Nowhere-on-sea" }), MEMBER);
      expect(h.geocode).toHaveBeenCalledWith("Nowhere-on-sea");
      expect(h.updates("events")[0].values).toEqual(expect.objectContaining({ location: "Nowhere-on-sea", lat: 53.8, lng: -1.5 }));
    });

    it("a changed location that geocodes moves the pin", async () => {
      const h = setup({ events: { row: pinned } });
      h.geocode.mockResolvedValue({ lat: 52.5, lng: -1.9 });
      await resubmit(h.deps, "event", "x1", form({ ...base, location: "Birmingham" }), MEMBER);
      expect(h.updates("events")[0].values).toEqual(expect.objectContaining({ lat: 52.5, lng: -1.9 }));
    });

    it("is conditional on the version read; a stale form is changed", async () => {
      const h = setup({ events: { row: pinned } });
      await resubmit(h.deps, "event", "x1", form({ ...base, version: OPENED }), MEMBER);
      expect(h.updates("events")[0].eq).toEqual(expect.arrayContaining([["status", "rejected"], ["updated_at", OPENED], ["source", "member"]]));
      expect(h.updates("events")[0].values).not.toHaveProperty("industry_id");

      const stale = setup({ events: { row: own({ updated_at: "2026-11-03T11:00:00+00:00" }) } });
      expect(await resubmit(stale.deps, "event", "x1", form({ ...base, version: OPENED }), MEMBER))
        .toEqual({ ok: false, code: "changed", error: MEMBER_CHANGED_ERROR.event });
      stale.nothingWritten();
    });

    it("a missing start date says why (D6)", async () => {
      const h = setup({ events: { row: pinned } });
      expect(await resubmit(h.deps, "event", "x1", form({ title: "t" }), MEMBER)).toEqual({ ok: false, code: "invalid", error: M.event.required });
    });
  });

  describe("save (console)", () => {
    it("creates a desk draft with member and industry", async () => {
      const h = setup({ events: { insert: dbOk({ id: "e2" }) } });
      expect(await save(h.deps, "event", null, form({ ...base, member_id: "m7", industry_id: "4", type: "webinar" }), ADMIN)).toEqual({ ok: true, id: "e2" });
      expect(h.inserts("events")[0].values).toEqual(expect.objectContaining({ status: "draft", source: "admin", submitted_by: "admin1", member_id: "m7", industry_id: 4, type: "webinar" }));
    });

    it("geocodes on the same rule as the member's edit: a failed lookup keeps the stored pin", async () => {
      const h = setup({ events: { row: { location: "Leeds", lat: 53.8, lng: -1.5 } } });
      await save(h.deps, "event", "e1", form({ ...base, location: "Somewhere new" }), ADMIN);
      expect(h.geocode).toHaveBeenCalledWith("Somewhere new");
      expect(h.updates("events")[0].values).toEqual(expect.objectContaining({ lat: 53.8, lng: -1.5 }));
    });

    it.each([
      ["create", null, { insert: dbError("boom") }],
      ["update", "e1", { write: dbError("boom") }],
    ] as const)("a failed %s says so and removes the new cover (D11)", async (_label, id, t) => {
      const h = setup({ events: t });
      h.store.mockResolvedValue({ path: "events/new.jpg" });
      expect(await save(h.deps, "event", id, form(base), ADMIN)).toEqual({ ok: false, code: "failed", error: M.saveFailed("event") });
      expect(h.remove).toHaveBeenCalledWith("events/new.jpg");
    });
  });
});

/* ================================================================== story */

describe("story", () => {
  describe("submit", () => {
    it("lands awaiting approval as member news with its cover, category and the member featured", async () => {
      const h = setup({ stories: { insert: dbOk({ id: "s9" }) } });
      h.store.mockResolvedValue({ path: "stories/c.jpg" });
      const res = await submit(h.deps, "story", form({ title: "My Story!", excerpt: "e", body: "<p>b</p>", category: "3", industry_id: "5", focus_x: "0.5", focus_y: "0.25" }), MEMBER);

      expect(res).toEqual({ ok: true, id: "s9", draft: false });
      expect(h.inserts("stories")[0].values).toEqual(expect.objectContaining({
        title: "My Story!", excerpt: "e", body: "<p>b</p>", status: "awaiting_approval", member_draft: false, source: "member",
        is_member_news: true, member_id: "mem1", submitted_by: "u1", industry_id: null, cover_path: "stories/c.jpg",
        cover_focus: { x: 0.5, y: 0.25, scale: 1 }, slug: expect.stringMatching(/^my-story-[0-9a-z]+$/),
      }));
      expect(h.sideInserts("story_categories")).toEqual([{ story_id: "s9", category_id: 3 }]);
      expect(h.db.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s9", p_member_ids: ["mem1"] });
      expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "story_submitted", payload: { story_id: "s9" } }));
    });

    it("needs a cover to go to the editor", async () => {
      const h = setup();
      expect(await submit(h.deps, "story", form({ title: "t" }), MEMBER)).toEqual({ ok: false, code: "invalid", error: M.story.coverRequired });
      h.nothingWritten();
    });

    it("Save draft keeps a private draft without a cover, and tells nobody", async () => {
      const h = setup({ stories: { insert: dbOk({ id: "s9" }) } });
      expect(await submit(h.deps, "story", form({ title: "WIP", intent: "draft" }), MEMBER)).toEqual({ ok: true, id: "s9", draft: true });
      expect(h.inserts("stories")[0].values).toEqual(expect.objectContaining({ status: "draft", member_draft: true, cover_path: null }));
      expect(h.notify).not.toHaveBeenCalled();
    });

    it.each([
      ["a draft", { title: " ", intent: "draft" }, M.story.draftTitleRequired],
      ["a submission", { title: " " }, M.story.titleRequired],
    ])("a blank title on %s says why (D6)", async (_label, fields, error) => {
      const h = setup();
      expect(await submit(h.deps, "story", form(fields), MEMBER)).toEqual({ ok: false, code: "invalid", error });
      expect(h.store).not.toHaveBeenCalled();
    });

    it("never reads the console's fields from a member's post", async () => {
      const h = setup();
      h.store.mockResolvedValue({ path: "stories/c.jpg" });
      await submit(h.deps, "story", form({ title: "t", member_id: "mem2", is_member_news: "", post_x: "https://x.com/a/status/1", tagged_member_ids: "11111111-1111-1111-1111-111111111111" }), MEMBER);
      const values = h.inserts("stories")[0].values;
      expect(values).toEqual(expect.objectContaining({ member_id: "mem1", is_member_news: true }));
      expect(values).not.toHaveProperty("social_posts");
      expect(h.db.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "new1", p_member_ids: ["mem1"] });
    });
  });

  describe("resubmit", () => {
    const story = (o: Record<string, unknown> = {}) => own({ member_draft: false, cover_path: "stories/old.jpg", ...o });

    it("goes back to the editor, conditional on state, draft flag and version; Jas's industry kept", async () => {
      const h = setup({ stories: { row: story({ status: "rejected" }) } });
      expect(await resubmit(h.deps, "story", "x1", form({ title: "Fixed", version: OPENED, industry_id: "5" }), MEMBER)).toEqual({ ok: true, id: "x1", draft: false });
      const [w] = h.updates("stories");
      expect(w.values).toEqual(expect.objectContaining({ title: "Fixed", status: "awaiting_approval", member_draft: false, rejected_reason: null }));
      expect(w.values).not.toHaveProperty("industry_id");
      expect(w.eq).toEqual(expect.arrayContaining([["status", "rejected"], ["member_draft", false], ["updated_at", OPENED], ["member_id", "mem1"], ["source", "member"]]));
      expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Resubmitted their story “Fixed” after changes." }));
    });

    it("a new cover frees the one it replaced, through the in-use check", async () => {
      const h = setup({ stories: { row: story() } });
      h.store.mockResolvedValue({ path: "stories/new.jpg" });
      await resubmit(h.deps, "story", "x1", form({ title: "t" }), MEMBER);
      expect(h.removeIfUnused).toHaveBeenCalledWith(["stories/old.jpg"]);
      expect(h.remove).not.toHaveBeenCalled();
    });

    it("a stale write removes the new cover, links no category and tells nobody", async () => {
      const h = setup({ stories: { row: story(), write: dbOk([]) } });
      h.store.mockResolvedValue({ path: "stories/new.jpg" });
      expect(await resubmit(h.deps, "story", "x1", form({ title: "t", category: "3" }), MEMBER)).toEqual({ ok: false, code: "changed", error: MEMBER_CHANGED_ERROR.story });
      expect(h.remove).toHaveBeenCalledWith("stories/new.jpg");
      expect(h.removeIfUnused).not.toHaveBeenCalled();
      expect(h.sideInserts("story_categories")).toEqual([]);
      expect(h.notify).not.toHaveBeenCalled();
    });

    it("replaces the category", async () => {
      const h = setup({ stories: { row: story() } });
      await resubmit(h.deps, "story", "x1", form({ title: "t", category: "4" }), MEMBER);
      expect(h.sideInserts("story_categories")).toEqual([{ story_id: "x1", category_id: 4 }]);
    });

    const draft = (o: Record<string, unknown> = {}) => story({ status: "draft", member_draft: true, cover_path: null, ...o });

    it("a draft saved again stays a draft, and nobody is told", async () => {
      const h = setup({ stories: { row: draft() } });
      expect(await resubmit(h.deps, "story", "x1", form({ title: "t", intent: "draft" }), MEMBER)).toEqual({ ok: true, id: "x1", draft: true });
      expect(h.updates("stories")[0].values).toEqual(expect.objectContaining({ status: "draft", member_draft: true }));
      expect(h.notify).not.toHaveBeenCalled();
    });

    it("a draft submitted needs a cover by then, and goes in as a fresh submission", async () => {
      const h = setup({ stories: { row: draft() } });
      expect(await resubmit(h.deps, "story", "x1", form({ title: "t" }), MEMBER)).toEqual({ ok: false, code: "invalid", error: M.story.coverRequired });

      const h2 = setup({ stories: { row: draft({ cover_path: "stories/c.jpg" }) } });
      await resubmit(h2.deps, "story", "x1", form({ title: "Done" }), MEMBER);
      expect(h2.updates("stories")[0].values).toEqual(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
      expect(h2.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Submitted a story for approval: “Done”." }));
    });

    it("Save draft can't pull a submitted story back out of the queue", async () => {
      const h = setup({ stories: { row: story() } });
      expect(await resubmit(h.deps, "story", "x1", form({ title: "t", intent: "draft" }), MEMBER)).toEqual({ ok: true, id: "x1", draft: false });
      expect(h.updates("stories")[0].values).toEqual(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
    });

    it("the desk's story about the member is not found; their own live story is changed", async () => {
      const desk = setup({ stories: { row: story({ source: "admin" }) } });
      expect(await resubmit(desk.deps, "story", "x1", form({ title: "t" }), MEMBER)).toEqual(expect.objectContaining({ code: "not_found" }));
      const live = setup({ stories: { row: story({ status: "published" }) } });
      expect(await resubmit(live.deps, "story", "x1", form({ title: "t" }), MEMBER)).toEqual(expect.objectContaining({ code: "changed" }));
    });
  });

  describe("save (console)", () => {
    const A = "11111111-1111-1111-1111-111111111111";
    const B = "22222222-2222-2222-2222-222222222222";

    it("creates a desk draft, features the subject and tagged members, links categories", async () => {
      const h = setup({ stories: { insert: dbOk({ id: "s2" }) } });
      const res = await save(h.deps, "story", null, form({ title: "New", member_id: A, tagged_member_ids: [B], categories: ["3", "4"], is_member_news: "on", industry_id: "2" }), ADMIN);
      expect(res).toEqual({ ok: true, id: "s2" });
      expect(h.inserts("stories")[0].values).toEqual(expect.objectContaining({
        status: "draft", source: "admin", submitted_by: "admin1", member_id: A, is_member_news: true, industry_id: 2,
      }));
      expect(h.db.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s2", p_member_ids: [A, B] });
      expect(h.sideInserts("story_categories")).toEqual([[{ story_id: "s2", category_id: 3 }, { story_id: "s2", category_id: 4 }]]);
    });

    it("a missing story or a member's private draft is not found, before the upload", async () => {
      for (const row of [null, { cover_path: null, member_draft: true, social_posts: null }]) {
        const h = setup({ stories: { row } });
        h.store.mockResolvedValue({ path: "stories/new.jpg" });
        expect(await save(h.deps, "story", "s1", form({ title: "T" }), ADMIN)).toEqual({ ok: false, code: "not_found", error: M.story.notAvailable });
        expect(h.store).not.toHaveBeenCalled();
        h.nothingWritten();
      }
    });

    it("replaces the cover and removes the old one; a post link the editor didn't touch keeps what's stored", async () => {
      const h = setup({ stories: { row: { cover_path: "stories/old.jpg", member_draft: false, social_posts: { x: "https://x.com/smi/status/9" } } } });
      h.store.mockResolvedValue({ path: "stories/new.jpg" });
      const f = form({ title: "T", post_x: "", post_x_was: "", post_linkedin: "https://www.linkedin.com/posts/a" });
      expect(await save(h.deps, "story", "s1", f, ADMIN)).toEqual({ ok: true, id: "s1" });
      const [w] = h.updates("stories");
      expect(w.values).toEqual(expect.objectContaining({ cover_path: "stories/new.jpg" }));
      expect(w.values.social_posts).toEqual(expect.objectContaining({ x: "https://x.com/smi/status/9", linkedin: "https://www.linkedin.com/posts/a" }));
      expect(h.remove).toHaveBeenCalledWith("stories/old.jpg");
    });

    it("tagged members without a subject, or a bad post link, are refused before anything is read or uploaded", async () => {
      for (const f of [form({ title: "T", tagged_member_ids: [B] }), form({ title: "T", post_facebook: "https://evil.example/fb" })]) {
        const h = setup();
        expect(await save(h.deps, "story", "s1", f, ADMIN)).toEqual(expect.objectContaining({ ok: false, code: "invalid" }));
        expect(h.store).not.toHaveBeenCalled();
        expect(h.db.from).not.toHaveBeenCalled();
      }
    });

    it("a failed retag: saved, but says the tagged members are as they were", async () => {
      const h = setup({ stories: { row: { cover_path: null, member_draft: false } }, rpc: async () => dbError("fk violation") });
      expect(await save(h.deps, "story", "s1", form({ title: "T", member_id: A }), ADMIN))
        .toEqual({ ok: false, code: "partial", error: M.story.membersFailed, id: "s1" });
    });

    it("a failed update removes the new cover and keeps the old one", async () => {
      const h = setup({ stories: { row: { cover_path: "stories/old.jpg", member_draft: false }, write: dbError("boom") } });
      h.store.mockResolvedValue({ path: "stories/new.jpg" });
      expect(await save(h.deps, "story", "s1", form({ title: "T" }), ADMIN)).toEqual({ ok: false, code: "failed", error: M.saveFailed("story") });
      expect(h.remove).toHaveBeenCalledWith("stories/new.jpg");
      expect(h.remove).not.toHaveBeenCalledWith("stories/old.jpg");
    });

    it("a blank title says why", async () => {
      const h = setup();
      expect(await save(h.deps, "story", null, form({ title: " " }), ADMIN)).toEqual({ ok: false, code: "invalid", error: M.story.titleRequired });
    });
  });
});
