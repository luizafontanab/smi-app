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

// Submission intake D6: a resubmit is refused if the item changed since the
// form opened, so the edit forms post the version they were rendered from.
describe("member edit forms post the version they opened at", () => {
  const version = () => (document.querySelector('input[type="hidden"][name="version"]') as HTMLInputElement | null)?.value;

  it("VideoForm", () => {
    render(
      <VideoForm
        action={noop}
        uploadImage={uploadImage}
        member={member}
        initial={{ id: "v1", version: "2026-11-03T09:00:00+00:00", title: "t", url: "https://youtu.be/abc", description: "", thumbnailUrl: null }}
      />,
    );
    expect(version()).toBe("2026-11-03T09:00:00+00:00");
  });

  it("EventForm", () => {
    render(
      <EventForm
        action={noop}
        uploadImage={uploadImage}
        member={{ name: "Acme Metal", slug: "acme" }}
        initial={{
          id: "e1", version: "2026-11-03T09:00:00+00:00", title: "t", description: "", startsOn: "2026-12-01", startsTime: null,
          endsOn: null, location: "", link: null, type: null, coverUrl: null,
        }}
      />,
    );
    expect(version()).toBe("2026-11-03T09:00:00+00:00");
  });

  it("no version on a new submission", () => {
    render(<VideoForm action={noop} uploadImage={uploadImage} member={member} />);
    expect(version()).toBeUndefined();
  });
});
