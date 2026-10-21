import { describe, expect, it } from "vitest";
import { addressLine, DEFAULT_REASON_LINE, newsletterFooterFromForm, parseNewsletterFooter, POSTAL_ADDRESS_MAX, readNewsletterFooter } from "@/lib/newsletter-footer";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseNewsletterFooter", () => {
  it("starts with no address and the drafted reason line", () => {
    expect(parseNewsletterFooter(null)).toEqual({ postal_address: "", reason_line: DEFAULT_REASON_LINE });
  });

  it("keeps stored values and falls a blank reason line back to the default", () => {
    expect(parseNewsletterFooter({ postal_address: " 1 High St ", reason_line: "  " })).toEqual({ postal_address: "1 High St", reason_line: DEFAULT_REASON_LINE });
    expect(parseNewsletterFooter({ postal_address: 42, reason_line: "Because." })).toEqual({ postal_address: "", reason_line: "Because." });
  });
});

describe("readNewsletterFooter", () => {
  it("reads the stored row, and the defaults when there is none", async () => {
    expect(await readNewsletterFooter(asDb(mockDb({ from: () => queryBuilder(dbOk({ value: { postal_address: "1 High St", reason_line: "" } })) }))))
      .toEqual({ postal_address: "1 High St", reason_line: DEFAULT_REASON_LINE });
    expect(await readNewsletterFooter(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) }))))
      .toEqual({ postal_address: "", reason_line: DEFAULT_REASON_LINE });
  });

  it("throws on a failed read rather than quietly rendering the defaults", async () => {
    // Swallowed, a transient error at send time would mail the whole list an
    // issue with no address and the drafted reason line, and report success.
    await expect(readNewsletterFooter(asDb(mockDb({ from: () => queryBuilder(dbError("connection reset")) }))))
      .rejects.toThrow(/newsletter footer.*connection reset/);
  });
});

describe("addressLine", () => {
  it("joins the typed lines with commas, without doubling a trailing one", () => {
    expect(addressLine("SMI Ltd,\r\n 1 High St \n\nCV31 1AA")).toBe("SMI Ltd, 1 High St, CV31 1AA");
    expect(addressLine("")).toBe("");
  });
});

describe("newsletterFooterFromForm", () => {
  it("trims the address, flattens the reason line's whitespace", () => {
    expect(newsletterFooterFromForm(form({ postal_address: " SMI\n1 High St ", reason_line: " You  signed\nup. " })))
      .toEqual({ value: { postal_address: "SMI\n1 High St", reason_line: "You signed up." } });
  });

  it("refuses an over-long address", () => {
    expect(newsletterFooterFromForm(form({ postal_address: "x".repeat(POSTAL_ADDRESS_MAX + 1), reason_line: "" })))
      .toEqual({ error: expect.stringContaining("postal address") });
  });
});
