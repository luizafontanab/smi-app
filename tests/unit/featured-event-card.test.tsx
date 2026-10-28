// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedEventCard, type FeaturedEventCardProps } from "@/components/console/FeaturedEventCard";

const event = { title: "Laser open day", slug: "laser-open-day", starts_on: "2099-11-20" };
const live = (over: Partial<FeaturedEventCardProps["live"]> = {}): FeaturedEventCardProps["live"] => ({
  event, source: "fallback", placement: null, ...over,
});

describe("FeaturedEventCard", () => {
  it("names a booked event, its term, and links to it and to the Adverts page", () => {
    render(<FeaturedEventCard live={live({ source: "booked", placement: { starts_on: "2099-11-01", ends_on: "2099-11-20" } })} next={null} />);
    expect(screen.getByRole("link", { name: "Laser open day" }).getAttribute("href")).toBe("/event/laser-open-day");
    expect(screen.getByText("Booked")).toBeTruthy();
    expect(screen.getByText(/booked 2099-11-01 → 2099-11-20/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage →" }).getAttribute("href")).toBe("/console/adverts/featured-event");
    expect(screen.getByText("Nothing else booked.")).toBeTruthy();
  });

  it("says when the backup pin or the automatic fallback is showing", () => {
    const { unmount } = render(<FeaturedEventCard live={live({ source: "backup" })} next={null} />);
    expect(screen.getByText("Backup pin")).toBeTruthy();
    unmount();
    render(<FeaturedEventCard live={live()} next={null} />);
    expect(screen.getByText("Next upcoming (automatic)")).toBeTruthy();
  });

  it("shows the next booking, and flags one still awaiting payment", () => {
    render(<FeaturedEventCard live={live()} next={{ title: "Golf day", starts_on: "2099-12-01", ends_on: "2099-12-05", awaiting_payment: true }} />);
    expect(screen.getByText("Golf day")).toBeTruthy();
    expect(screen.getByText(/2099-12-01 → 2099-12-05 \(awaiting payment\)/)).toBeTruthy();
  });

  it("says the homepage card is hidden when there is no event at all", () => {
    render(<FeaturedEventCard live={live({ event: null })} next={null} />);
    expect(screen.getByText(/homepage card is hidden/)).toBeTruthy();
  });
});
