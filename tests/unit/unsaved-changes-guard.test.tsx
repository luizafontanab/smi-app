// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- the guard intercepts
   plain DOM anchors (which is all next/link renders to); a router-free anchor
   is exactly what these tests need */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

// jsdom can't navigate; swallow the click at the end of the bubble phase so
// allowed-through links don't log "Not implemented: navigation". The guard's
// capture-phase listener has already run by the time this fires, so a click
// it stopped (stopPropagation) never gets here — `propagated` counts the
// clicks the guard let through.
let propagated = 0;
const swallow = (e: MouseEvent) => {
  propagated += 1;
  e.preventDefault();
};

const spyOnConfirm = () => vi.spyOn(window, "confirm").mockReturnValue(false);
let confirmSpy: ReturnType<typeof spyOnConfirm>;

beforeEach(() => {
  propagated = 0;
  confirmSpy = spyOnConfirm();
  document.addEventListener("click", swallow);
});

afterEach(() => {
  cleanup(); // unmount before removing the swallow listener
  document.removeEventListener("click", swallow);
  confirmSpy.mockRestore();
});

function renderForm() {
  render(
    <>
      <a href="/elsewhere">Away</a>
      <a href="https://example.com/">External</a>
      <form>
        <UnsavedChangesGuard />
        <label htmlFor="name">Name</label>
        <input id="name" name="name" defaultValue="" />
      </form>
    </>,
  );
  return {
    input: screen.getByLabelText("Name"),
    link: screen.getByText("Away"),
    external: screen.getByText("External"),
    form: document.querySelector("form")!,
  };
}

describe("UnsavedChangesGuard", () => {
  it("lets internal link clicks through while the form is untouched", () => {
    const { link } = renderForm();
    fireEvent.click(link);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(propagated).toBe(1);
  });

  it("prompts once dirty and blocks the click when declined", () => {
    const { input, link } = renderForm();
    fireEvent.input(input, { target: { value: "edited" } });
    fireEvent.click(link);
    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved changes — leave this page?");
    expect(propagated).toBe(0); // preventDefault + stopPropagation
  });

  it("lets the click through when the prompt is accepted, and stops prompting", () => {
    confirmSpy.mockReturnValue(true);
    const { input, link } = renderForm();
    fireEvent.input(input, { target: { value: "edited" } });
    fireEvent.click(link);
    expect(propagated).toBe(1);
    // accepting means "leaving deliberately" — no second prompt
    fireEvent.click(link);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(propagated).toBe(2);
  });

  it("is clean again after submit", () => {
    const { input, link, form } = renderForm();
    fireEvent.input(input, { target: { value: "edited" } });
    fireEvent.submit(form);
    fireEvent.click(link);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("ignores external links and modifier clicks (beforeunload / new tab handle those)", () => {
    const { input, link, external } = renderForm();
    fireEvent.input(input, { target: { value: "edited" } });
    fireEvent.click(external);
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { button: 1 });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("arms beforeunload only while dirty", () => {
    const { input, form } = renderForm();

    const fire = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };

    expect(fire()).toBe(false);
    fireEvent.change(input, { target: { value: "edited" } });
    expect(fire()).toBe(true);
    fireEvent.submit(form);
    expect(fire()).toBe(false);
  });

  it("guards only its own form when several guards share a page", () => {
    render(
      <>
        <a href="/elsewhere">Away</a>
        <form aria-label="first">
          <UnsavedChangesGuard />
          <input aria-label="first field" />
        </form>
        <form aria-label="second">
          <UnsavedChangesGuard />
          <input aria-label="second field" />
        </form>
      </>,
    );
    // dirty the first form, then save it — the second guard never armed
    fireEvent.input(screen.getByLabelText("first field"), { target: { value: "x" } });
    fireEvent.submit(screen.getByRole("form", { name: "first" }));
    fireEvent.click(screen.getByText("Away"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("removes its listeners on unmount", () => {
    const { unmount } = render(
      <form>
        <UnsavedChangesGuard />
        <input aria-label="field" />
      </form>,
    );
    fireEvent.input(screen.getByLabelText("field"), { target: { value: "x" } });
    unmount();
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
