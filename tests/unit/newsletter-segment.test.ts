import { afterEach, describe, expect, it, vi } from "vitest";
import { getNewsletterSender } from "@/lib/adapters/newsletter";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

/**
 * ResendNewsletterSender.syncContacts keeps the Resend segment equal to
 * `contacts`. It used to only ever add: an address that left `contacts` — the
 * old address after an email change (a Bigin pull or a console edit), a deleted
 * contact, someone set to "not subscribed" — stayed in the segment, subscribed,
 * and broadcasts go to the segment. Pinned here: the prune, and that it never
 * runs off a partial list.
 */
afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const SEG = "seg_1";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function live() {
  vi.stubEnv("RESEND_API_KEY", "re_123");
  vi.stubEnv("RESEND_SEGMENT_ID", SEG);
}

/** contacts: subscribed rows, then unsubscribed rows — the order syncContacts reads them in. */
function contacts(subscribed: DbResult, unsubscribed: DbResult = dbOk([])) {
  let call = 0;
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(() => (call++ === 0 ? subscribed : unsubscribed)) })));
}

/** Resend, routed by method + path; an unexpected call throws so it fails the test instead of reaching the network. */
function resend(segmentPages: Array<{ data: { id: string; email: string; unsubscribed?: boolean }[]; has_more: boolean }> | Response, removal = () => json({ deleted: true })) {
  let page = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && url.pathname === "/contacts") return json({ object: "contact", id: "x" });
    if (method === "GET" && url.pathname === `/segments/${SEG}/contacts`) {
      return segmentPages instanceof Response ? segmentPages : json({ object: "list", ...segmentPages[page++] });
    }
    if (method === "DELETE" && url.pathname.endsWith(`/segments/${SEG}`)) return removal();
    if (method === "PATCH" && url.pathname.startsWith("/contacts/")) return json({ object: "contact", id: "x" });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
}

const removed = (spy: ReturnType<typeof resend>) =>
  spy.mock.calls.filter(([, i]) => i?.method === "DELETE").map(([u]) => decodeURIComponent(new URL(String(u)).pathname.split("/")[2]));

describe("syncContacts — pruning the segment", () => {
  it("takes out an address no longer in contacts — the old one after an email change — and keeps everyone else", async () => {
    live();
    contacts(dbOk([{ email: "new@b.com", name: null }]), dbOk([{ email: "out@b.com" }]));
    const spy = resend([{ data: [
      { id: "r1", email: "old@b.com" }, // the contact's previous address
      { id: "r2", email: "New@B.com" }, // still a contact — case doesn't matter
      { id: "r3", email: "out@b.com" }, // unsubscribed: stays, so Resend keeps suppressing it
    ], has_more: false }]);

    const result = await getNewsletterSender().syncContacts();

    expect(removed(spy)).toEqual(["old@b.com"]);
    expect(spy.mock.calls.find(([, i]) => i?.method === "DELETE")![0]).toBe(`https://api.resend.com/contacts/old%40b.com/segments/${SEG}`);
    expect(result).toEqual({ pushed: 3, failed: 0 }); // two pushes + one removal
  });

  it("marks an unsubscribe Resend still has as subscribed — a 409 on create may not have updated it", async () => {
    live();
    contacts(dbOk([]), dbOk([{ email: "out@b.com" }, { email: "gone@b.com" }]));
    const spy = resend([{ data: [
      { id: "r1", email: "out@b.com", unsubscribed: false }, // unsubscribed here, still subscribed at Resend
      { id: "r2", email: "gone@b.com", unsubscribed: true }, // already suppressed there: leave it
    ], has_more: false }]);

    await getNewsletterSender().syncContacts();

    const patches = spy.mock.calls.filter(([, i]) => i?.method === "PATCH");
    expect(patches.map(([u]) => String(u))).toEqual(["https://api.resend.com/contacts/out%40b.com"]);
    expect(JSON.parse(String(patches[0][1]!.body))).toEqual({ unsubscribed: true });
    expect(removed(spy)).toEqual([]); // unsubscribed contacts stay in the segment, suppressed
  });

  it("follows the listing's pages with `after` the last id", async () => {
    live();
    contacts(dbOk([]));
    const spy = resend([
      { data: [{ id: "r1", email: "a@b.com" }], has_more: true },
      { data: [{ id: "r2", email: "c@d.com" }], has_more: false },
    ]);

    await getNewsletterSender().syncContacts();

    const listings = spy.mock.calls.filter(([, i]) => (i?.method ?? "GET") === "GET").map(([u]) => new URL(String(u)).search);
    expect(listings).toEqual(["?limit=100", "?limit=100&after=r1"]);
    expect(removed(spy)).toEqual(["a@b.com", "c@d.com"]);
  });

  it("removes nothing when the segment can't be listed, and reports the sync as failed", async () => {
    live();
    vi.spyOn(console, "error").mockImplementation(() => {});
    contacts(dbOk([{ email: "a@b.com", name: null }]));
    const spy = resend(new Response("server error", { status: 500 }));

    expect(await getNewsletterSender().syncContacts()).toEqual({ pushed: 1, failed: 1 });
    expect(removed(spy)).toEqual([]);
  });

  it("counts a 404 on removal as done — already out of the segment", async () => {
    live();
    contacts(dbOk([]));
    resend([{ data: [{ id: "r1", email: "gone@b.com" }], has_more: false }], () => json({ name: "not_found" }, 404));
    expect(await getNewsletterSender().syncContacts()).toEqual({ pushed: 1, failed: 0 });
  });

  it("backs off on a 429 during the prune, like the pushes do", async () => {
    live();
    contacts(dbOk([]));
    resend([{ data: [{ id: "r1", email: "gone@b.com" }], has_more: false }], () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } }));
    await expect(getNewsletterSender().syncContacts()).rejects.toMatchObject({ name: "EmailSendError", status: 429, retryAfterMs: 2000 });
  });

  it("never prunes off a failed contacts read — it throws before touching Resend", async () => {
    live();
    contacts(dbError("connection reset") as DbResult);
    const spy = resend([{ data: [{ id: "r1", email: "a@b.com" }], has_more: false }]);
    await expect(getNewsletterSender().syncContacts()).rejects.toThrow(/connection reset/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("syncContacts — reading and pushing contacts", () => {
  it("reads past PostgREST's 1,000-row cap, so nobody after the first thousand is dropped (or pruned)", async () => {
    live();
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ email: `p${i}@b.com`, name: null }));
    let call = 0;
    // subscribed: two pages; then unsubscribed: empty
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(() => [dbOk(page1), dbOk([{ email: "last@b.com", name: null }]), dbOk([])][Math.min(call++, 2)]),
    })));
    const spy = resend([{ data: [{ id: "r1", email: "last@b.com" }], has_more: false }]);

    expect(await getNewsletterSender().syncContacts()).toEqual({ pushed: 1001, failed: 0 });
    expect(removed(spy)).toEqual([]);
  });

  it("sends segments the way Resend's create-contact documents them: objects carrying the id", async () => {
    live();
    contacts(dbOk([{ email: "a@b.com", name: null }]));
    const spy = resend([{ data: [], has_more: false }]);
    await getNewsletterSender().syncContacts();
    const post = spy.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ email: "a@b.com", unsubscribed: false, segments: [{ id: SEG }] });
  });
});
