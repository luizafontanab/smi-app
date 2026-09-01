import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAndStoreInvoicePdf, signedInvoiceUrl } from "@/lib/invoice-pdf";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

const DETAILS = { number: "SMI-JOIN-X", amountPennies: 4000, issuedOn: "2026-08-31", memberName: "Acme Ltd" };

describe("generateAndStoreInvoicePdf", () => {
  it("uploads a real PDF buffer to the private invoices bucket and returns the storage path", async () => {
    const upload = vi.fn<(path: string, body: unknown, opts: unknown) => Promise<ReturnType<typeof dbOk>>>(async () => dbOk(null));
    const storageFrom = vi.fn(() => ({ upload }));
    const from = vi.fn();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, storage: { from: storageFrom } })));

    const path = await generateAndStoreInvoicePdf("m1", DETAILS);

    expect(path).toBe("m1/SMI-JOIN-X.pdf");
    expect(storageFrom).toHaveBeenCalledWith("invoices");
    const [uploadedPath, buffer, opts] = upload.mock.calls[0];
    expect(uploadedPath).toBe("m1/SMI-JOIN-X.pdf");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect((buffer as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(opts).toEqual({ contentType: "application/pdf" });
    // Invoices must never get a media row: the media library renders public
    // URLs, and these documents are private billing records.
    expect(from).not.toHaveBeenCalledWith("media");
  });

  it("returns null rather than throwing when the upload fails", async () => {
    const upload = vi.fn(async () => ({ data: null, error: { message: "storage down" } }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: vi.fn(() => ({ upload })) } })));
    const errorSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const path = await generateAndStoreInvoicePdf("m1", DETAILS);

    expect(path).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("signedInvoiceUrl", () => {
  it("signs the path against the invoices bucket", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/signed" }, error: null }));
    const storageFrom = vi.fn(() => ({ createSignedUrl }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: storageFrom } })));

    expect(await signedInvoiceUrl("m1/SMI-JOIN-X.pdf")).toBe("https://x/signed");
    expect(storageFrom).toHaveBeenCalledWith("invoices");
    expect(createSignedUrl).toHaveBeenCalledWith("m1/SMI-JOIN-X.pdf", 3600);
  });

  it("strips the legacy invoices/ prefix from paths written before the private bucket", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/signed" }, error: null }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: vi.fn(() => ({ createSignedUrl })) } })));

    await signedInvoiceUrl("invoices/m1/SMI-JOIN-X.pdf");
    expect(createSignedUrl).toHaveBeenCalledWith("m1/SMI-JOIN-X.pdf", 3600);
  });

  it("returns null when signing fails", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: { message: "no such object" } }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: vi.fn(() => ({ createSignedUrl })) } })));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await signedInvoiceUrl("m1/missing.pdf")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
