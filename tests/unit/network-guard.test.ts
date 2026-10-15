import { describe, expect, it } from "vitest";

// tests/setup.ts: no unit test may reach the internet; only the local stack.
describe("test network guard", () => {
  it("refuses a request to a public host before it leaves the machine", async () => {
    await expect(fetch("https://api.resend.com/contacts")).rejects.toThrow(/Test tried to reach the network: https:\/\/api\.resend\.com\/contacts/);
  });

  it("refuses a Request object too", async () => {
    await expect(fetch(new Request("https://www.zohoapis.eu/bigin/v2/Contacts"))).rejects.toThrow(/reach the network/);
  });

  it("lets a local request through (the integration suites' Supabase stack)", async () => {
    // Port 9 (discard) has nothing listening: the guard passes it on and the
    // connection itself fails — which is not the guard's error.
    const result = await fetch("http://127.0.0.1:9/").catch((e: Error) => e);
    expect(String(result)).not.toMatch(/reach the network/);
  });
});
