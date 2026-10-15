// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubmitButton } from "@/components/SubmitButton";
import { beginUpload, endUpload } from "@/lib/upload-pending";

describe("SubmitButton", () => {
  it("shows its label and isn't disabled outside a pending submission", () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
  });

  // Jas 13/10 item 3: saving mid-upload would drop the image from the body.
  it("waits, disabled, while an upload (an editor image, a file field) is still in flight", async () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>,
    );
    act(() => beginUpload());
    expect(screen.getByRole("button")).toHaveTextContent("Waiting for upload…");
    expect(screen.getByRole("button")).toBeDisabled();
    act(() => endUpload());
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("swaps to the pending label and disables while its form action is in flight", async () => {
    let resolveAction: () => void = () => {};
    const action = () => new Promise<void>((resolve) => { resolveAction = resolve; });

    render(
      <form action={action}>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Saving…"));
    expect(screen.getByRole("button")).toBeDisabled();

    await act(async () => {
      resolveAction();
    });
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Save"));
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
