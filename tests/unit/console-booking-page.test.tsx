// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BookingPage from "@/app/console/adverts/[id]/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));
// An async server component with its own reads; not what these tests are about.
vi.mock("@/components/console/InvoicePanel", () => ({ InvoicePanel: () => null }));

afterEach(() => resetDbServerMocks());

const ID = "22222222-2222-4222-8222-222222222222";
const props = { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) } as never;

function bookingDb(over: Record<string, unknown>) {
  const booking = {
    id: ID, status: "draft", source: "admin", starts_on: "2026-11-01", ends_on: "2026-11-30", bundle_id: null,
    price_pennies: 65000, review_reason: null, ended_at: null, ended_reason: null, ended_note: null,
    advert: { id: "ad1", name: "Acme banner", format: "banner", desktop_path: null, mobile_path: null, member: { name: "Acme" } },
    ...over,
  };
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      advert_bookings: () => queryBuilder(dbOk(booking)),
      advert_artwork_proposals: () => queryBuilder(dbOk(null)),
      analytics_events: () => queryBuilder(dbOk(null, 0)),
    }),
  })));
}

/** The booking id the button's form posts — what bookDraftRun reads. */
const postedId = (button: HTMLElement) => (button.closest("form")!.querySelector('input[name="id"]') as HTMLInputElement).value;

// Review finding: renewBooking redirects here with a draft, and this page had
// nothing to do with one — no way to book it, so the rebook went nowhere.
describe("console booking page — a renewal's draft", () => {
  it("offers to book it, at the carried-forward price", async () => {
    bookingDb({});
    render(await BookingPage(props));

    expect(screen.getByRole("heading", { name: "Book this run" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Price/)).toHaveValue("650.00");
    expect(postedId(screen.getByRole("button", { name: /^Book/ }))).toBe(ID);
  });

  it("asks no price of a bundle part — its bundle's invoice covers it", async () => {
    bookingDb({ bundle_id: "bd1", price_pennies: null });
    render(await BookingPage(props));

    expect(screen.getByRole("heading", { name: "Book this run" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Price/)).not.toBeInTheDocument();
    expect(postedId(screen.getByRole("button", { name: "Book & schedule" }))).toBe(ID);
  });

  it("is not offered for a member's own draft, or a run already booked", async () => {
    bookingDb({ source: "member" });
    const { unmount } = render(await BookingPage(props));
    expect(screen.queryByRole("heading", { name: "Book this run" })).not.toBeInTheDocument();
    unmount();

    bookingDb({ status: "scheduled" });
    render(await BookingPage(props));
    expect(screen.queryByRole("heading", { name: "Book this run" })).not.toBeInTheDocument();
  });
});
