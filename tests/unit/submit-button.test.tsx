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

describe("SubmitButton — #48: every working button is disabled and says so", () => {
  function deferred() {
    let resolve: () => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it("names only the pressed button as working when a second button has its own formAction", async () => {
    const save = deferred();
    const withdraw = deferred();
    render(
      <form action={() => save.promise}>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        <SubmitButton pendingLabel="Withdrawing…" formAction={() => withdraw.promise}>Withdraw</SubmitButton>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Withdrawing…" })).toBeDisabled());
    // the other button is off too, but doesn't claim to be the one working
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText("Saving…")).toBeNull();

    await act(async () => withdraw.resolve());
  });

  it("marks the working button aria-busy, and comes back clickable after the action throws", async () => {
    const run = deferred();
    render(
      <form action={() => run.promise.catch(() => {})}>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true"));

    await act(async () => run.reject(new Error("network")));
    const button = await screen.findByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  // Code review: SubmitButton is on every form now, so a page-wide "an upload is
  // running" would grey out Sign out, mark read and every other form's button.
  it("waits only for an upload in its own form", () => {
    render(
      <>
        <form data-testid="uploading">
          <SubmitButton pendingLabel="Saving…">Save artwork</SubmitButton>
        </form>
        <form>
          <SubmitButton pendingLabel="Signing out…">Sign out</SubmitButton>
        </form>
      </>,
    );
    const form = screen.getByTestId("uploading") as HTMLFormElement;
    act(() => beginUpload(form));
    expect(screen.getByRole("button", { name: "Waiting for upload…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeDisabled();
    act(() => endUpload(form));
    expect(screen.getByRole("button", { name: "Save artwork" })).not.toBeDisabled();
  });

  it("passes through its own disabled, aria-label and onClick, and always gets a disabled style", () => {
    let clicked = 0;
    render(
      <form>
        <SubmitButton pendingLabel="…" aria-label="Move up" className="px-1" onClick={(e) => { e.preventDefault(); clicked++; }}>↑</SubmitButton>
        <SubmitButton pendingLabel="…" aria-label="Move down" disabled>↓</SubmitButton>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    expect(clicked).toBe(1);
    expect(screen.getByRole("button", { name: "Move up" })).toHaveClass("px-1", "disabled:opacity-50");
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });
});
