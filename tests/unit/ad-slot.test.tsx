// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import type { LiveAdvert } from "@/lib/adverts";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

function advert(overrides: Partial<LiveAdvert> = {}): LiveAdvert {
  return {
    advertId: "ad1", name: "Acme Fabrication", desktopPath: "adverts/ad1-desktop.jpg", mobilePath: "adverts/ad1-mobile.jpg",
    linkUrl: null, memberSlug: "acme", memberId: "m1", ...overrides,
  };
}

describe("AdSlot", () => {
  it("renders nothing for an empty slot when placeholders are off", () => {
    const { container } = render(<AdSlot adverts={[]} showPlaceholders={false} path="/news" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a labelled placeholder footprint per shape, without touching AdCreative", () => {
    render(<AdSlot adverts={[]} shape="mpu" slotKey="story_ad_1" showPlaceholders path="/news" />);
    expect(screen.getByText("Advert space")).toBeInTheDocument();
    expect(screen.getByText(/story_ad_1/)).toBeInTheDocument();
  });
});

describe("SupplierLogos", () => {
  it("renders nothing with no adverts and placeholders off", () => {
    const { container } = render(<SupplierLogos adverts={[]} showPlaceholders={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows five placeholder tiles when there is no live inventory but placeholders are on", () => {
    const { container } = render(<SupplierLogos adverts={[]} showPlaceholders />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5);
  });

  it("links a real advert's logo to its visit URL", () => {
    const { container } = render(<SupplierLogos adverts={[advert()]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/visit/ad1");
    expect(container.querySelector("img")).toHaveAttribute("alt", "Acme Fabrication");
  });
});
