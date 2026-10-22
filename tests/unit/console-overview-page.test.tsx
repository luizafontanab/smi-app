// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CommandCentre from "@/app/console/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => resetDbServerMocks());

const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never;

function overviewDb(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  // Every other overview query: empty, with a zero count.
  const from = fromByTable(map, () => queryBuilder(dbOk([], 0)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, rpc: async () => dbOk(null) })));
  return from;
}

describe("console overview", () => {
  it("lists pending stories in the board's order — most recently touched first", async () => {
    const stories = queryBuilder(dbOk([], 0));
    overviewDb({ stories: () => stories });
    render(await CommandCentre(props));
    expect(stories.order).toHaveBeenCalledWith("updated_at", { ascending: false });
  });

  // Review finding 8: a member's page edit was approvable from here without
  // seeing what it changed. It's reviewed on the member's page now.
  it("sends a pending page edit to the member's page to review, with no blind Approve", async () => {
    overviewDb({
      member_revisions: () => queryBuilder(dbOk([{ id: "r1", member_id: "m1", member: { name: "Acme Ltd" } }])),
    });
    render(await CommandCentre(props));
    expect(screen.getByRole("link", { name: "Review changes" })).toHaveAttribute("href", "/console/members/m1#changes");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

// Review finding: the revenue figure summed the bookings live today — bundle
// parts at a per-format rate, the bundle's own price never — so it read
// neither what was billed nor what arrived. It reads invoices now.
describe("console overview revenue", () => {
  afterEach(() => vi.useRealTimers());

  /** Both invoice reads, in the order the page makes them: paid this month, then unpaid. */
  function invoiceReads(paid: unknown[], unpaid: unknown[]) {
    const reads = [queryBuilder(dbOk(paid)), queryBuilder(dbOk(unpaid))];
    let call = 0;
    overviewDb({ members: () => queryBuilder(dbOk([], 2)), invoices: () => reads[call++] });
    return { paid: reads[0], unpaid: reads[1] };
  }

  it("counts what was paid this month, by stream, and shows what is still owed beside it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const { paid, unpaid } = invoiceReads(
      [
        { number: "SMI-ADV-MG3K2Q7F-0001", amount_pennies: 48000, placement: null }, // a bundle's one invoice
        { number: "SMI-ADV-MG3K2Q7F-0002", amount_pennies: 35000, placement: { kind: "featured_member" } },
      ],
      [{ number: "SMI-ADV-MG3K2Q7F-0003", amount_pennies: 65000, placement: null }],
    );
    render(await CommandCentre(props));

    expect(paid.eq).toHaveBeenCalledWith("status", "paid");
    // UK months (GAPS A3.9): 1 Oct starts at midnight BST, 23:00 UTC the day before; 1 Nov is back in GMT.
    expect(paid.gte).toHaveBeenCalledWith("paid_at", "2026-09-30T23:00:00.000Z");
    expect(paid.lt).toHaveBeenCalledWith("paid_at", "2026-11-01T00:00:00.000Z");
    expect(unpaid.eq).toHaveBeenCalledWith("status", "issued");

    // 2 members × £40 + £480 advertising + £350 featured; the £650 owed is not in it.
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "£910 / month")).toBeInTheDocument();
    expect(screen.getByText(/£650 invoiced, awaiting payment/)).toBeInTheDocument();
  });

  const orCalls = (b: ReturnType<typeof queryBuilder>) => (b.or as ReturnType<typeof vi.fn>).mock.calls as [string][];

  // 16 Oct: a comped member is active but pays nothing until comped_until passes.
  it("counts only paying members as membership revenue, and says how many are comped", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const membersReads: ReturnType<typeof queryBuilder>[] = [];
    overviewDb({
      // 3 active; the read filtered to "not comped, or comp expired" finds 2.
      members: () => {
        const b: ReturnType<typeof queryBuilder> = queryBuilder(() => dbOk([], orCalls(b).length ? 2 : 3));
        membersReads.push(b);
        return b;
      },
    });
    render(await CommandCentre(props));

    expect(membersReads.some((b) => orCalls(b).some(([f]) => f === "comped_until.is.null,comped_until.lt.2026-10-15"))).toBe(true);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "£80 / month")).toBeInTheDocument();
    expect(screen.getByText(/2 paying members × £40\/mo · 1 comped, not counted/)).toBeInTheDocument();
  });

  it("rolls the month over at the year end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    const { paid } = invoiceReads([], []);
    render(await CommandCentre(props));

    expect(paid.gte).toHaveBeenCalledWith("paid_at", "2026-12-01T00:00:00.000Z");
    expect(paid.lt).toHaveBeenCalledWith("paid_at", "2027-01-01T00:00:00.000Z");
  });
});
