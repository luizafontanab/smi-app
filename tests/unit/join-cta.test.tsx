// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JoinCta } from "@/components/JoinCta";
import { currentUser } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ currentUser: vi.fn() }));

afterEach(() => {
  vi.mocked(currentUser).mockReset();
});

// JoinCta is an async Server Component — call it directly and render the
// resolved element rather than passing the component to render() (RTL's
// client-side render can't await a component's own body).
describe("JoinCta", () => {
  it("renders the join band for a signed-out visitor", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    render(<>{await JoinCta()}</>);
    expect(screen.getByRole("link", { name: "Become a Member" })).toHaveAttribute("href", "/join");
  });

  it("renders nothing once someone has already joined", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      userId: "u1", email: "member@acme.test", role: "member", memberId: "m1", displayName: "Acme Co",
    });
    const { container } = render(<>{await JoinCta()}</>);
    expect(container).toBeEmptyDOMElement();
  });
});
