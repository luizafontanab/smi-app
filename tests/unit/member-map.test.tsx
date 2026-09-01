// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemberMap } from "@/components/MemberMap";

// The real MemberMapImpl (and its react-leaflet import) is covered by its own
// test — this one is only about the next/dynamic(ssr:false) wrapper: does it
// show a loading skeleton, then swap to the real map once the chunk resolves.
vi.mock("@/components/MemberMapImpl", () => ({
  MemberMap: ({ members }: { members: { slug: string }[] }) => <div data-testid="real-map">{members.length} members</div>,
}));

describe("MemberMap (dynamic wrapper)", () => {
  it("eventually renders the real map, passing members through", async () => {
    render(<MemberMap members={[{ slug: "acme", name: "Acme", lat: 1, lng: 1 }]} />);
    await waitFor(() => expect(screen.getByTestId("real-map")).toBeInTheDocument());
    expect(screen.getByTestId("real-map")).toHaveTextContent("1 members");
  });
});
