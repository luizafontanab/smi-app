// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DevTaskWidget } from "@/components/dev-task/DevTaskWidget";
import { submitDevTask } from "@/app/actions";

vi.mock("@/app/actions", () => ({ submitDevTask: vi.fn() }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  vi.mocked(submitDevTask).mockReset();
});

describe("DevTaskWidget", () => {
  it("opens the report dialog from the Feedback trigger", () => {
    render(<DevTaskWidget reporterName="Jas" />);
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("open");
    expect(screen.getByText(/Filing as Jas/)).toBeInTheDocument();
  });

  it("offers every kind and priority option", () => {
    render(<DevTaskWidget reporterName="Jas" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("bug");
    expect(screen.getByRole("option", { name: "Idea" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toHaveValue("medium");
  });

  it("Cancel closes the dialog without submitting", () => {
    render(<DevTaskWidget reporterName="Jas" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
    expect(submitDevTask).not.toHaveBeenCalled();
  });

  it("a successful submission closes the dialog and shows a flash message", async () => {
    vi.mocked(submitDevTask).mockResolvedValue({ message: "Logged as #42.", ok: true });
    render(<DevTaskWidget reporterName="Jas" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Broken link" } });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open"));
    expect(screen.getByText("Logged as #42.")).toBeInTheDocument();
  });

  it("a failed submission keeps the dialog open and shows the error inline", async () => {
    vi.mocked(submitDevTask).mockResolvedValue({ message: "Too many reports just now — please try again shortly." });
    render(<DevTaskWidget reporterName="Jas" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Broken link" } });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(screen.getByText(/Too many reports/)).toBeInTheDocument());
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("open");
  });
});
