// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemberMap } from "@/components/MemberMap";

// The real PinMapImpl (and its Google Maps import) is covered by its own
// test — this one is about the next/dynamic(ssr:false) wrapper plus the
// MemberMap adapter: show a loading skeleton, then swap to the real map once
// the chunk resolves, with members translated into pins.
vi.mock("@/components/PinMapImpl", () => ({
  PinMap: ({ pins }: { pins: { href: string; label: string }[] }) => (
    <div data-testid="real-map">{pins.map((p) => `${p.label}@${p.href}`).join(",")}</div>
  ),
}));

describe("MemberMap (adapter over the dynamic PinMap wrapper)", () => {
  it("eventually renders the real map, passing members through as pins", async () => {
    render(<MemberMap members={[{ slug: "acme", name: "Acme", lat: 1, lng: 1 }]} />);
    await waitFor(() => expect(screen.getByTestId("real-map")).toBeInTheDocument());
    expect(screen.getByTestId("real-map")).toHaveTextContent("Acme@/member/acme");
  });
});
