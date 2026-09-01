import PDFDocument from "pdfkit";
import { serviceDb } from "./db/server";

export type InvoiceDetails = {
  number: string;
  amountPennies: number;
  issuedOn: string;
  memberName: string;
};

function renderInvoicePdf(details: InvoiceDetails): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Sheet Metal Industries");
    doc.fontSize(14).fillColor("#5a6068").text("Invoice");
    doc.moveDown();
    doc.fontSize(11).fillColor("#111418");
    doc.text(`Invoice number: ${details.number}`);
    doc.text(`Issued: ${details.issuedOn}`);
    doc.text(`Billed to: ${details.memberName}`);
    doc.moveDown();
    doc.text("SMI membership", { continued: true });
    doc.text(`£${(details.amountPennies / 100).toFixed(2)}`, { align: "right" });
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#5a6068").text("Sheet Metal Industries — sheetmetalindustries.com");

    doc.end();
  });
}

/**
 * Bucket for generated invoices. Private, unlike `media`: these PDFs carry the
 * member's name and what they paid, and `media` is served unauthenticated at a
 * URL derived directly from the stored path. Access goes through
 * signedInvoiceUrl() on the billing page instead.
 */
export const INVOICE_BUCKET = "invoices";

/**
 * Generate an invoice PDF, upload it to the private invoices bucket, and
 * return the storage path — or null on any failure. Best-effort by design: a
 * payment is already recorded by the time this runs (GAPS A4.7), so a
 * PDF-generation hiccup must never roll back or block the invoice row it
 * documents. Deliberately no `media` row: the media library is public site
 * content and renders public URLs, which is exactly what an invoice must not
 * get — the invoice row's pdf_path is the only reference.
 */
export async function generateAndStoreInvoicePdf(memberId: string, details: InvoiceDetails): Promise<string | null> {
  try {
    const buffer = await renderInvoicePdf(details);
    const db = serviceDb();
    const path = `${memberId}/${details.number}.pdf`;
    const { error } = await db.storage.from(INVOICE_BUCKET).upload(path, buffer, { contentType: "application/pdf" });
    if (error) throw new Error(error.message);
    return path;
  } catch (e) {
    console.warn(`[invoice-pdf] could not generate/store invoice ${details.number}:`, e);
    return null;
  }
}

/**
 * Short-lived download URL for an invoice the caller has already authorised
 * (the billing page only reads invoices scoped to the session's member_id).
 * Handles legacy `invoices/…`-prefixed paths written when PDFs lived in the
 * public media bucket. Null on failure — the page shows "PDF soon" rather
 * than a dead link.
 */
export async function signedInvoiceUrl(path: string): Promise<string | null> {
  const key = path.startsWith("invoices/") ? path.slice("invoices/".length) : path;
  const { data, error } = await serviceDb().storage.from(INVOICE_BUCKET).createSignedUrl(key, 3600);
  if (error) {
    console.warn(`[invoice-pdf] could not sign ${key}: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}
