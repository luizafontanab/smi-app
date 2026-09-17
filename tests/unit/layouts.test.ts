import { afterEach, describe, expect, it, vi } from "vitest";
import { getLayout } from "@/lib/blocks/layouts";
import { DEFAULT_LAYOUTS } from "@/lib/blocks/defaults";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => resetDbServerMocks());

const VALID = DEFAULT_LAYOUTS.static_page; // known-valid per the schema, since it's the fallback of last resort
const INVALID = { blocks: "not-an-array" };
// entity_id is a uuid column; getLayout ignores anything else (see the guard).
const STORY_1 = "11111111-1111-4111-8111-111111111111";

describe("getLayout", () => {
  it("falls back to the code default with no stored rows at all", async () => {
    const builder = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    expect(await getLayout("static_page")).toBe(DEFAULT_LAYOUTS.static_page);
  });

  it("with no entityId, queries only the page-type default row", async () => {
    const builder = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    await getLayout("story");

    expect(builder.is).toHaveBeenCalledWith("entity_id", null);
    expect(builder.or).not.toHaveBeenCalled();
  });

  it("with an entityId, queries both the override and the type default in one call", async () => {
    const builder = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    await getLayout("story", STORY_1);

    expect(builder.or).toHaveBeenCalledWith(`entity_id.eq.${STORY_1},entity_id.is.null`);
  });

  it("treats a non-uuid entityId as absent rather than interpolating it into the filter", async () => {
    const builder = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    await getLayout("story", "x,entity_id.not.is.null");

    expect(builder.or).not.toHaveBeenCalled();
    expect(builder.is).toHaveBeenCalledWith("entity_id", null);
  });

  it("prefers a valid per-entity override over the page-type default", async () => {
    const override = { ...VALID, note: "override" };
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([{ entity_id: STORY_1, layout: override }, { entity_id: null, layout: VALID }])),
    })));

    expect(await getLayout("static_page", STORY_1)).toEqual(override);
  });

  it("falls back to the page-type default row when only it exists", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([{ entity_id: null, layout: VALID }])),
    })));

    expect(await getLayout("static_page", STORY_1)).toEqual(VALID);
  });

  it("skips an invalid override row and falls through to a valid default", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([{ entity_id: STORY_1, layout: INVALID }, { entity_id: null, layout: VALID }])),
    })));

    expect(await getLayout("static_page", STORY_1)).toEqual(VALID);
  });

  it("falls back to the code default when every stored row is invalid", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk([{ entity_id: STORY_1, layout: INVALID }, { entity_id: null, layout: INVALID }])),
    })));

    expect(await getLayout("static_page", STORY_1)).toBe(DEFAULT_LAYOUTS.static_page);
  });
});
