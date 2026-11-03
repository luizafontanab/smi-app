// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoForm } from "@/app/dashboard/video/new/VideoForm";
import { EventForm } from "@/app/dashboard/event/new/EventForm";
import { StoryForm } from "@/app/dashboard/story/new/StoryForm";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const noop = async () => {};
const uploadImage = async () => ({ error: "not in this test" });
const member = { name: "Acme Metal", slug: "acme", logoUrl: null };

// Industries are Jas's alone: members never see or pick one, on a new
// submission or an edit. The console's own editors keep the field.
describe("member content forms have no industry field", () => {
  const noIndustry = () => {
    expect(screen.queryByLabelText(/industry/i)).toBeNull();
    expect(document.querySelector('[name="industry_id"]')).toBeNull();
  };

  it("VideoForm, new and edit", () => {
    const { unmount } = render(<VideoForm action={noop} uploadImage={uploadImage} member={member} />);
    noIndustry();
    unmount();
    render(
      <VideoForm
        action={noop}
        uploadImage={uploadImage}
        member={member}
        initial={{ id: "v1", title: "Bending 101", url: "https://www.youtube.com/watch?v=abc123", description: "", thumbnailUrl: null }}
      />,
    );
    noIndustry();
  });

  it("EventForm", () => {
    render(<EventForm action={noop} uploadImage={uploadImage} member={{ name: "Acme Metal", slug: "acme" }} />);
    noIndustry();
  });

  it("StoryForm", () => {
    render(
      <StoryForm
        action={noop}
        uploadImage={uploadImage}
        previewBody={async (html) => html}
        categories={[{ id: 1, name: "Machinery" }]}
        member={member}
      />,
    );
    noIndustry();
  });
});
