import { afterEach, describe, expect, it, vi } from "vitest";
import { recordRename, resolveRedirect } from "@/lib/redirects";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

/** Queues one maybeSingle() result per hop, in order — a fresh row lookup each call. */
function hops(...rows: (Record<string, unknown> | null)[]) {
  let i = 0;
  return fromByTable({ redirects: () => queryBuilder(dbOk(rows[i++] ?? null)) });
}

describe("resolveRedirect", () => {
  it("returns null when nothing redirects from this path", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: hops(null) })));

    expect(await resolveRedirect("/gone")).toBeNull();
  });

  it("resolves a single 301 hop as permanent", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: hops({ to_path: "/b", status_code: 301 }) })));

    expect(await resolveRedirect("/a")).toEqual({ to: "/b", permanent: true });
  });

  it("resolves a 302/307 hop as temporary", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: hops({ to_path: "/b", status_code: 302 }) })));

    expect(await resolveRedirect("/a")).toEqual({ to: "/b", permanent: false });
  });

  it("follows a chain to its final destination", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: hops(
        { to_path: "/b", status_code: 301 },
        { to_path: "/c", status_code: 301 },
        null, // /c has no further redirect
      ),
    })));

    expect(await resolveRedirect("/a")).toEqual({ to: "/c", permanent: true });
  });

  it("detects a cycle and returns null rather than looping forever", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: hops(
        { to_path: "/b", status_code: 301 },
        { to_path: "/a", status_code: 301 }, // back to the start
      ),
    })));

    expect(await resolveRedirect("/a")).toBeNull();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "redirects:cycle", context: { at: "/b", to: "/a" } }));
  });

  it("stops after MAX_HOPS rather than following a chain forever", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: hops(
        { to_path: "/1", status_code: 301 },
        { to_path: "/2", status_code: 301 },
        { to_path: "/3", status_code: 301 },
        { to_path: "/4", status_code: 301 },
        { to_path: "/5", status_code: 301 },
        { to_path: "/6", status_code: 301 }, // never reached
      ),
    })));

    expect(await resolveRedirect("/a")).toEqual({ to: "/5", permanent: true });
  });
});

describe("recordRename", () => {
  it("does nothing when the path hasn't actually changed", async () => {
    const from = vi.fn();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await recordRename("/same", "/same");

    expect(from).not.toHaveBeenCalled();
  });

  it("drops the reverse row, upserts the rename, and flattens existing chains", async () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await recordRename("/acme", "/acme-ltd");

    expect(from).toHaveBeenCalledWith("redirects");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("from_path", "/acme-ltd"); // dropping the reverse row
    expect(builder.upsert).toHaveBeenCalledWith({ from_path: "/acme", to_path: "/acme-ltd", status_code: 301 });
    expect(builder.update).toHaveBeenCalledWith({ to_path: "/acme-ltd" });
    expect(builder.eq).toHaveBeenCalledWith("to_path", "/acme"); // flattening old chains onto the new path
    expect(builder.neq).toHaveBeenCalledWith("from_path", "/acme-ltd");
  });
});
