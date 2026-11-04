// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PinMap } from "@/components/PinMapImpl";

// Same Google Maps stand-in as pin-map-impl.test.tsx: only the gesture mode is
// under test here.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Map: ({ children, gestureHandling }: { children: React.ReactNode; gestureHandling: string }) => (
    <div data-testid="map" data-gestures={gestureHandling}>{children}</div>
  ),
  AdvancedMarker: () => null,
  InfoWindow: () => null,
  useAdvancedMarkerRef: () => [() => {}, null],
}));

function stubPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("PinMapImpl on touch screens (#33)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is cooperative on a coarse pointer even where a mouse gets wheel zoom, so one finger scrolls the page", () => {
    stubPointer(true);
    render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-gestures", "cooperative");
  });

  it("keeps greedy wheel zoom for a mouse", () => {
    stubPointer(false);
    render(<PinMap pins={[]} ariaLabel="Map" />);
    expect(screen.getByTestId("map")).toHaveAttribute("data-gestures", "greedy");
  });
});
