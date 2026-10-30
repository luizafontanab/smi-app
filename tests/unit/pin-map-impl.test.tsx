// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PinMap, type MapPin } from "@/components/PinMapImpl";

// Google Maps loads its real script from Google and draws into a canvas, which
// jsdom can't do — this tests PinMapImpl's OWN logic (centre-of-pins, marker
// and popup wiring, the no-key fallback), not Google's rendering.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children, apiKey }: { children: React.ReactNode; apiKey: string }) => (
    <div data-testid="api-provider" data-key={apiKey}>{children}</div>
  ),
  Map: ({ children, defaultCenter, defaultZoom, gestureHandling, mapId }: {
    children: React.ReactNode;
    defaultCenter: { lat: number; lng: number };
    defaultZoom: number;
    gestureHandling: string;
    mapId: string;
  }) => (
    <div data-testid="map" data-center={JSON.stringify(defaultCenter)} data-zoom={defaultZoom} data-gestures={gestureHandling} data-map-id={mapId}>
      {children}
    </div>
  ),
  AdvancedMarker: ({ children, position, title, onClick }: {
    children: React.ReactNode;
    position: { lat: number; lng: number };
    title: string;
    onClick?: () => void;
  }) => (
    <button type="button" data-testid="marker" data-position={JSON.stringify(position)} title={title} onClick={onClick}>
      {children}
    </button>
  ),
  InfoWindow: ({ children, onCloseClick }: { children: React.ReactNode; onCloseClick: () => void }) => (
    <div data-testid="popup">
      {children}
      <button type="button" onClick={onCloseClick}>Close</button>
    </div>
  ),
  useAdvancedMarkerRef: () => [() => {}, null],
}));

function pin(overrides: Partial<MapPin> = {}): MapPin {
  return { href: "/member/acme", label: "Acme Fabrication", lat: 53.4, lng: -1.5, ...overrides };
}

describe("PinMapImpl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("loads Google Maps with the configured key, and Google's demo map id when none is set", () => {
    render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("api-provider")).toHaveAttribute("data-key", "test-key");
    expect(screen.getByTestId("map")).toHaveAttribute("data-map-id", "DEMO_MAP_ID");
  });

  it("uses SMI's own map id when one is set", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID", "smi-map");
    render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-map-id", "smi-map");
  });

  it("shows a quiet 'Map unavailable' box, not Google's error, when there's no key", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
    render(<PinMap pins={[pin()]} ariaLabel="Map of member locations" />);
    expect(screen.getByRole("region", { name: "Map of member locations" })).toHaveTextContent("Map unavailable");
    expect(screen.queryByTestId("api-provider")).not.toBeInTheDocument();
  });

  it("centres on the UK when there are no pins", () => {
    render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-center", JSON.stringify({ lat: 54.5, lng: -3 }));
    expect(screen.queryByTestId("marker")).not.toBeInTheDocument();
  });

  it("centres on the average position of the pins shown", () => {
    render(<PinMap pins={[pin({ lat: 50, lng: 0 }), pin({ href: "/member/b", lat: 54, lng: -2 })]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-center", JSON.stringify({ lat: 52, lng: -1 }));
  });

  it("passes the zoom through, defaulting to the whole-UK view", () => {
    const { rerender } = render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "6");
    rerender(<PinMap pins={[]} ariaLabel="Map" zoom={13} />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-zoom", "13");
  });

  it("renders one titled marker per pin, whose popup links to its page", () => {
    render(<PinMap pins={[pin()]} ariaLabel="Map" />);
    const marker = screen.getByTestId("marker");
    expect(marker).toHaveAttribute("data-position", JSON.stringify({ lat: 53.4, lng: -1.5 }));
    expect(marker).toHaveAttribute("title", "Acme Fabrication");
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();

    fireEvent.click(marker);
    expect(screen.getByRole("link", { name: "Acme Fabrication" })).toHaveAttribute("href", "/member/acme");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
  });

  it("keeps only one popup open at a time", () => {
    render(<PinMap pins={[pin(), pin({ href: "/member/b", label: "B Metals", lat: 51, lng: 0 })]} ariaLabel="Map" />);
    const [a, b] = screen.getAllByTestId("marker");
    fireEvent.click(a);
    fireEvent.click(b);
    expect(screen.getAllByTestId("popup")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "B Metals" })).toBeInTheDocument();
  });

  it("opens no popup when popups are off (a profile's own map)", () => {
    render(<PinMap pins={[pin()]} ariaLabel="Map" popups={false} />);
    fireEvent.click(screen.getByTestId("marker"));
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
  });

  it("lets page scroll pass over the map when wheel zoom is off", () => {
    const { rerender } = render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-gestures", "greedy");
    rerender(<PinMap pins={[]} ariaLabel="Map" scrollWheelZoom={false} />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-gestures", "cooperative");
  });

  it("labels the map region for assistive tech", () => {
    render(<PinMap pins={[]} ariaLabel="Map of member locations" />);
    expect(screen.getByRole("region", { name: "Map of member locations" })).toBeInTheDocument();
  });
});
