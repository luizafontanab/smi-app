// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberMap, type MapMember } from "@/components/MemberMapImpl";

// react-leaflet renders through raw Leaflet DOM/canvas machinery that jsdom
// can't drive (tile positioning, ResizeObserver, real layout) — this tests
// MemberMapImpl's OWN logic (center-of-members, marker/popup wiring), not
// Leaflet's rendering, which the library owns and doesn't need re-testing here.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, center, zoom }: { children: React.ReactNode; center: [number, number]; zoom: number }) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom}>{children}</div>
  ),
  TileLayer: ({ url }: { url: string }) => <div data-testid="tile-layer" data-url={url} />,
  Marker: ({ children, position }: { children: React.ReactNode; position: [number, number] }) => (
    <div data-testid="marker" data-position={JSON.stringify(position)}>{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}));

function member(overrides: Partial<MapMember> = {}): MapMember {
  return { slug: "acme", name: "Acme Fabrication", lat: 53.4, lng: -1.5, ...overrides };
}

describe("MemberMapImpl", () => {
  it("centres on the UK when there are no members", () => {
    render(<MemberMap members={[]} />);
    expect(screen.getByTestId("map-container")).toHaveAttribute("data-center", JSON.stringify([54.5, -3]));
    expect(screen.queryByTestId("marker")).not.toBeInTheDocument();
  });

  it("centres on the average position of the members shown", () => {
    render(<MemberMap members={[member({ lat: 50, lng: 0 }), member({ slug: "b", lat: 54, lng: -2 })]} />);
    expect(screen.getByTestId("map-container")).toHaveAttribute("data-center", JSON.stringify([52, -1]));
  });

  it("renders one marker per member, popped up with a link to their page", () => {
    render(<MemberMap members={[member({ slug: "acme", name: "Acme Fabrication", lat: 53.4, lng: -1.5 })]} />);
    expect(screen.getByTestId("marker")).toHaveAttribute("data-position", JSON.stringify([53.4, -1.5]));
    expect(screen.getByRole("link", { name: "Acme Fabrication" })).toHaveAttribute("href", "/member/acme");
  });

  it("renders the OpenStreetMap tile layer", () => {
    render(<MemberMap members={[]} />);
    expect(screen.getByTestId("tile-layer")).toHaveAttribute("data-url", "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
  });
});
