import { afterEach, describe, expect, it, vi } from "vitest";
import { isMemberLinkable, PUBLIC_MEMBER_STATUSES } from "@/lib/member-visibility";
import { activePlacements, activeTakeover, memberBySlug } from "@/lib/queries";
import { publicDb, serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * Archiving a member (fix list 72, migration 20260923000002). The hiding is
 * done by RLS — `public_read_active_members` now carries `archived_at is null`
 * — so the interesting cases here are the ones RLS cannot reach: the shared
 * predicate that four pages gate their member credit on, the serviceDb() reads
 * that bypass the policy, and memberBySlug's admin escape hatch.
 *
 * The stubs deliberately do not model filtering, so "publicDb cannot see an
 * archived member" is expressed the only way it can be honestly: the public
 * client is configured to return what the policy would return (nothing), and
 * the assertion is on *which client memberBySlug chose* — that choice is the
 * whole mechanism, since no application-level filter could undo RLS.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

/** publicDb() and serviceDb() wired to separate fakes — which one a query picks is the thing under test. */
function clients(
  pub: Record<string, () => ReturnType<typeof queryBuilder>>,
  svc: Record<string, () => ReturnType<typeof queryBuilder>>,
) {
  const anon = fromByTable(pub);
  const service = fromByTable(svc);
  vi.mocked(publicDb).mockReturnValue(asDb(mockDb({ from: anon })));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: service })));
  return { anon, service };
}

const ARCHIVED = { id: "m1", slug: "acme", name: "Acme", status: "active", archived_at: "2026-09-23T10:00:00Z" };
const LIVE = { id: "m2", slug: "brassworks", name: "Brassworks", status: "active", archived_at: null };

describe("isMemberLinkable", () => {
  it("passes a live member", () => {
    expect(isMemberLinkable(LIVE)).toBe(true);
    expect(isMemberLinkable({ slug: "x", name: "X", status: "grace", archived_at: null })).toBe(true);
  });

  it("rejects an archived member whatever their status", () => {
    expect(isMemberLinkable(ARCHIVED)).toBe(false);
    expect(isMemberLinkable({ status: "grace", archived_at: "2026-01-01T00:00:00Z" })).toBe(false);
  });

  it("rejects a status with no public page", () => {
    expect(isMemberLinkable({ status: "lapsed", archived_at: null })).toBe(false);
    expect(isMemberLinkable({ status: "draft", archived_at: null })).toBe(false);
  });

  it("rejects a null embed — an RLS-filtered member comes back as null, not as a row", () => {
    expect(isMemberLinkable(null)).toBe(false);
    expect(isMemberLinkable(undefined)).toBe(false);
  });

  it("accepts a projection carrying neither column, because RLS has already judged it", () => {
    // VIDEO_CARD / EVENT_FIELDS select only slug and name. Those are publicDb
    // reads, so the policy has applied both halves of the rule before the row
    // exists at all — this call is the null check, on purpose.
    expect(isMemberLinkable({ slug: "acme", name: "Acme" })).toBe(true);
  });

  it("matches what memberBySlug serves", () => {
    for (const status of PUBLIC_MEMBER_STATUSES) expect(isMemberLinkable({ status, archived_at: null })).toBe(true);
  });
});

describe("memberBySlug", () => {
  it("reads as anon by default, so an archived member is simply absent", async () => {
    // What the anon role sees post-20260923000002: the row is outside the policy.
    const { anon, service } = clients(
      { members: () => queryBuilder(dbOk(null)) },
      { members: () => queryBuilder(dbOk(ARCHIVED)) },
    );

    expect(await memberBySlug("acme")).toBeNull();
    expect(anon).toHaveBeenCalledWith("members");
    // serviceDb bypasses RLS — the public path must never touch it.
    expect(service).not.toHaveBeenCalled();
  });

  it("switches to serviceDb for includeArchived, which is the only way past the policy", async () => {
    const { anon, service } = clients(
      { members: () => queryBuilder(dbOk(null)) },
      { members: () => queryBuilder(dbOk(ARCHIVED)), stories: () => queryBuilder(dbOk([])) },
    );

    const member = await memberBySlug("acme", { includeArchived: true });

    expect(member).toMatchObject({ slug: "acme", archived_at: "2026-09-23T10:00:00Z" });
    expect(service).toHaveBeenCalledWith("members");
    expect(anon).not.toHaveBeenCalled();
  });

  it("keeps the status filter in both modes — archiving is orthogonal to the billing lifecycle", async () => {
    const anonMembers = queryBuilder(dbOk(null));
    const serviceMembers = queryBuilder(dbOk(null));
    clients({ members: () => anonMembers }, { members: () => serviceMembers });

    await memberBySlug("acme");
    await memberBySlug("acme", { includeArchived: true });

    expect(anonMembers.in).toHaveBeenCalledWith("status", PUBLIC_MEMBER_STATUSES);
    expect(serviceMembers.in).toHaveBeenCalledWith("status", PUBLIC_MEMBER_STATUSES);
  });
});

describe("activePlacements", () => {
  const placement = (over: Record<string, unknown>) => ({ kind: "featured_member", grid_position: null, config: null, member: null, machine: null, ...over });

  it("nulls an archived featured member, so the paid slot renders as nothing", async () => {
    clients({}, { placements: () => queryBuilder(dbOk([placement({ member: ARCHIVED })])) });

    const [p] = await activePlacements();

    expect(p.member).toBeNull();
  });

  it("keeps a live featured member untouched", async () => {
    clients({}, { placements: () => queryBuilder(dbOk([placement({ member: LIVE })])) });

    const [p] = await activePlacements();

    expect(p.member).toMatchObject({ slug: "brassworks" });
  });

  it("drops the seller credit from a machine but keeps the machine", async () => {
    clients({}, {
      placements: () => queryBuilder(dbOk([placement({
        kind: "featured_machine",
        machine: { id: "fm1", name: "Press brake", status: "published", member: ARCHIVED },
      })])),
    });

    const [p] = await activePlacements();

    expect(p.machine).toMatchObject({ id: "fm1", status: "published" });
    expect(p.machine?.member).toBeNull();
  });

  it("selects the two columns it judges on — serviceDb has no policy to fall back on", async () => {
    const placements = queryBuilder(dbOk([]));
    clients({}, { placements: () => placements });

    await activePlacements();

    expect(placements.select).toHaveBeenCalledWith(expect.stringContaining("status, archived_at"));
  });
});

describe("activeTakeover", () => {
  const config = { hex: "#ff0000", banner_path: "takeover.png" };

  it("stops linking the banner at an archived sponsor", async () => {
    clients({}, { placements: () => queryBuilder(dbOk({ config, member: ARCHIVED })) });

    expect(await activeTakeover()).toEqual({ hex: "#ff0000", bannerPath: "takeover.png", memberSlug: null });
  });

  it("still links a live sponsor", async () => {
    clients({}, { placements: () => queryBuilder(dbOk({ config, member: LIVE })) });

    expect(await activeTakeover()).toMatchObject({ memberSlug: "brassworks" });
  });
});
