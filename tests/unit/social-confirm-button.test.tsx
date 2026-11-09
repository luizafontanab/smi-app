// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormPendingSignal } from "@/components/FormPendingSignal";
import { SocialConfirmButton } from "@/components/console/SocialConfirmButton";

/**
 * #48: Confirm sits in the editor's form but submits SocialConfirmForm (via
 * `form=`), so it can't read that form's pending state the usual way. The
 * form carries a FormPendingSignal; the buttons listen to it.
 */
describe("SocialConfirmButton — pending (#48)", () => {
  it("disables every Confirm and labels the pressed one until the confirm finishes", async () => {
    let finish: () => void = () => {};
    const confirm = () => new Promise<void>((resolve) => { finish = resolve; });
    render(
      <>
        <form id="confirm-form" action={confirm} hidden>
          <FormPendingSignal />
        </form>
        <form>
          <SocialConfirmButton form="confirm-form" value="schedule:x" pendingLabel="Confirming…">Confirm X</SocialConfirmButton>
          <SocialConfirmButton form="confirm-form" value="schedule:all">Confirm all (2)</SocialConfirmButton>
        </form>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm X" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Confirming…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Confirm all (2)" })).toBeDisabled();

    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm X" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Confirm all (2)" })).not.toBeDisabled();
  });

  it("submits under the name and value it's given, so one form can carry several actions", () => {
    const { container } = render(
      <form>
        <SocialConfirmButton form="tool-form" name="write_channel" value="li">Write with Claude</SocialConfirmButton>
      </form>,
    );
    const button = container.querySelector("button")!;
    expect(button.getAttribute("name")).toBe("write_channel");
    expect(button.getAttribute("value")).toBe("li");
    expect(button.getAttribute("form")).toBe("tool-form");
  });
});
