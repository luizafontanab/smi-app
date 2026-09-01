import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Locks in migration 20260901000014: the anon (publishable-key) role must not
 * be able to write to the public-form tables directly — that path bypassed the
 * server actions' rate limiting and validation — nor call the two
 * security-definer metric RPCs whose numbers the app reports as truth.
 * Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!ANON_KEY || !SECRET_KEY)("anon write lockdown (migration 20260901000014)", () => {
  const anon = () => createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });

  it("anon cannot insert into inbox_messages (would bypass the contact-form rate limit)", async () => {
    const { error } = await anon().from("inbox_messages").insert({ kind: "contact", name: "x", email: "x@x.test", message: "flood" });
    expect(error?.code).toBe("42501");
  });

  it("anon cannot insert into newsletter_signups", async () => {
    const { error } = await anon().from("newsletter_signups").insert({ email: "flood@x.test" });
    expect(error?.code).toBe("42501");
  });

  it("anon cannot call bump_newsletter_metric (open/click counts are reported as truth)", async () => {
    const { error } = await anon().rpc("bump_newsletter_metric", { p_broadcast_id: "x", p_metric: "opens" });
    expect(error?.code).toBe("42501");
  });

  it("anon cannot call bump_consent_stats", async () => {
    const { error } = await anon().rpc("bump_consent_stats", { p_consented: true });
    expect(error?.code).toBe("42501");
  });

  it("anon reads still work (the lockdown must not break the public site)", async () => {
    const { error } = await anon().from("categories").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("the service role can still call the metric RPCs", async () => {
    const service = createClient(URL_, SECRET_KEY!, { auth: { persistSession: false } });
    // unknown broadcast id: updates zero rows, proving only that execute is granted
    const { error } = await service.rpc("bump_newsletter_metric", { p_broadcast_id: "no-such-broadcast", p_metric: "opens" });
    expect(error).toBeNull();
  });
});

describe.skipIf(!ANON_KEY || !SECRET_KEY)("invoice PDFs are private (GAPS A4.7 hardening)", () => {
  it("the invoices bucket exists, is private, and objects are unreachable without a signed URL", async () => {
    const service = createClient(URL_, SECRET_KEY!, { auth: { persistSession: false } });
    const path = `itest/${Date.now()}.pdf`;
    const upload = await service.storage.from("invoices").upload(path, Buffer.from("%PDF-1.4 test"), { contentType: "application/pdf" });
    expect(upload.error).toBeNull();

    try {
      // public-URL fetch must fail: the bucket is private
      const publicUrl = `${URL_}/storage/v1/object/public/invoices/${path}`;
      const publicRes = await fetch(publicUrl);
      expect(publicRes.ok).toBe(false);

      // a signed URL from the service role must succeed
      const signed = await service.storage.from("invoices").createSignedUrl(path, 60);
      expect(signed.error).toBeNull();
      const signedRes = await fetch(signed.data!.signedUrl);
      expect(signedRes.ok).toBe(true);
    } finally {
      await service.storage.from("invoices").remove([path]);
    }
  });
});
