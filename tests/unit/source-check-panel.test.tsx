// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceCheckPanel } from "@/components/console/SourceCheckPanel";
import type { SourceCheckRun } from "@/lib/sources/run";

vi.mock("@/app/console/sources/actions", () => ({ checkSourcesNow: vi.fn() }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const NOW = Date.parse("2026-11-05T10:45:00Z");
const run = (over: Partial<SourceCheckRun> = {}): SourceCheckRun => ({
  id: "run-1", started_at: "2026-11-05T10:42:00Z", finished_at: "2026-11-05T10:42:50Z", started_by: "Jas",
  due: 40, checked: 40, new_items: 12, unreadable: 0, failed: 0, still_due: 0, ...over,
});
const panel = (props: Partial<Parameters<typeof SourceCheckPanel>[0]>) =>
  render(<SourceCheckPanel run={run()} crawlerOn returnTo="/console" nowMs={NOW} {...props} />);

describe("SourceCheckPanel", () => {
  it("links to the suggestions the admin's own check found", () => {
    panel({ flash: "done", flashRun: "run-1" });
    expect(screen.getByRole("status")).toHaveTextContent("Check finished.");
    expect(screen.getByRole("link", { name: "See the 12 new suggestions →" })).toBeInTheDocument();
  });

  it("doesn't pass a newer run's count off as the admin's, once a scheduled check has replaced the record", () => {
    panel({ run: run({ id: "scheduled-run", started_by: null, new_items: 3 }), flash: "done", flashRun: "run-1" });
    expect(screen.getByRole("status")).toHaveTextContent("Check finished. A newer check has run since; its summary is below.");
    expect(screen.queryByRole("link", { name: /new suggestion/ })).toBeNull();
  });

  it("tells a check that never started from one that stopped part-way", () => {
    const { unmount } = panel({ flash: "notstarted" });
    expect(screen.getByRole("status")).toHaveTextContent("The check couldn't start, so nothing was checked.");
    unmount();
    panel({ flash: "failed" });
    expect(screen.getByRole("status")).toHaveTextContent("The check stopped with an error. Anything it checked before that is saved");
  });

  it("disables the button while a check still holds the lock", () => {
    panel({ run: run({ started_at: "2026-11-05T10:44:00Z", finished_at: null }), flash: "held", flashRun: "run-1" });
    expect(screen.getByRole("status")).toHaveTextContent("still answering");
    expect(screen.getByRole("button", { name: "Check sources now" })).toBeDisabled();
  });
});
