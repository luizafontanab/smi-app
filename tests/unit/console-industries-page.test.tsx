// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IndustriesPage from "@/app/console/industries/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));

afterEach(() => resetDbServerMocks());

/**
 * A table of `total` rows behind PostgREST's 1000-row cap: an unranged read
 * gets only the first 1000, a ranged one gets its slice.
 */
function capped(total: number, row: (i: number) => Record<string, unknown>) {
  const builder: ReturnType<typeof queryBuilder> = queryBuilder((): DbResult => {
    const calls: [number, number][] = vi.mocked(builder.range as (a: number, b: number) => unknown).mock.calls;
    const [from, to] = calls.at(-1) ?? [0, 999];
    const end = Math.min(to + 1, total, from + 1000);
    return dbOk(Array.from({ length: Math.max(0, end - from) }, (_, k) => row(from + k)));
  });
  return builder;
}

describe("/console/industries counts", () => {
  it("counts every member's primary industry, past the 1000-row cap", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        industries: () => queryBuilder(dbOk([{ id: 7, name: "Aerospace", slug: "aerospace" }])),
        member_industries: () => capped(1203, () => ({ industry_id: 7 })),
        members: () => capped(1203, () => ({ industry_id: 7 })),
      }),
    })));

    render(await IndustriesPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    expect(screen.getByText("1203 members · 1203 primary")).toBeInTheDocument();
  });
});
