// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MirrorInput } from "@/components/console/MirrorInput";

/**
 * The editors' Approve / Schedule forms carry the Save form's Industry box
 * through this, so approving sends the industry Jas can see (review fix, 3 Nov).
 */
function editor(selected: string) {
  return render(
    <>
      <form aria-label="save">
        <select id="industry_id" name="industry_id" defaultValue={selected}>
          <option value="">— none —</option>
          <option value="3">Aerospace</option>
          <option value="7">Automotive</option>
        </select>
      </form>
      <form aria-label="approve">
        <MirrorInput source="industry_id" name="industry_id" defaultValue={selected} />
      </form>
    </>,
  );
}

const approveForm = (c: HTMLElement) => new FormData(c.querySelector<HTMLFormElement>("form[aria-label=approve]")!);

describe("MirrorInput", () => {
  it("starts with what the box shows", () => {
    const { container } = editor("3");
    expect(approveForm(container).get("industry_id")).toBe("3");
  });

  it("follows a change made without saving", () => {
    const { container } = editor("3");
    fireEvent.change(container.querySelector("#industry_id")!, { target: { value: "7" } });
    expect(approveForm(container).get("industry_id")).toBe("7");
  });

  it("sends an empty value for '— none —', so the server knows the box was there", () => {
    const { container } = editor("3");
    fireEvent.change(container.querySelector("#industry_id")!, { target: { value: "" } });
    const fd = approveForm(container);
    expect(fd.has("industry_id")).toBe(true);
    expect(fd.get("industry_id")).toBe("");
  });

  it("keeps its default when the source field isn't on the page", () => {
    const { container } = render(<form aria-label="approve"><MirrorInput source="missing" name="industry_id" defaultValue="3" /></form>);
    expect(approveForm(container).get("industry_id")).toBe("3");
  });
});
