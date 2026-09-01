import { afterEach, describe, expect, it, vi } from "vitest";
import { getCrmSync } from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getCrmSync — local mirror stub", () => {
  it("timestamps unsynced contacts rather than touching already-synced ones", async () => {
    const builder = queryBuilder(dbOk([]));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await getCrmSync().sync();

    expect(from).toHaveBeenCalledWith("contacts");
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_synced_at: expect.any(String) }));
    expect(builder.is).toHaveBeenCalledWith("bigin_id", null);
  });

  it("logs a would-push line for pushContact rather than calling out anywhere", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await getCrmSync().pushContact({ email: "acme@example.com" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("acme@example.com"));
  });
});

describe("getCrmSync — BiginCrmSync", () => {
  async function freshCrm() {
    // cachedToken lives at module scope by design (it's the point being
    // tested); reset the module between tests so it doesn't leak.
    vi.resetModules();
    const { getCrmSync } = await import("@/lib/adapters/crm");
    return getCrmSync();
  }

  function liveEnv() {
    vi.stubEnv("BIGIN_CLIENT_ID", "id_1");
    vi.stubEnv("BIGIN_CLIENT_SECRET", "secret_1");
    vi.stubEnv("BIGIN_REFRESH_TOKEN", "refresh_1");
  }

  function withContactsUpdate() {
    const builder = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));
    return builder;
  }

  it("falls back to the local stub when Bigin env vars are incomplete", async () => {
    vi.stubEnv("BIGIN_CLIENT_ID", "id_1"); // secret/refresh token missing
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await (await freshCrm()).pushContact({ email: "acme@example.com" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("acme@example.com"));
  });

  it("fetches a token, searches by email, creates the contact (no match), and writes the returned id back to bigin_id", async () => {
    liveEnv();
    const builder = withContactsUpdate();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // A20: search finds no existing contact
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ code: "SUCCESS", details: { id: "abc123" }, status: "success" }] }), { status: 200 }));

    await (await freshCrm()).pushContact({ email: "a@b.com", name: "A", company: "Acme" });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(String(tokenInit?.body)).toContain("refresh_token=refresh_1");

    const [searchUrl] = fetchMock.mock.calls[1];
    expect(searchUrl).toBe("https://www.zohoapis.eu/crm/v2/Contacts/search?criteria=(Email:equals:a%40b.com)");

    const [contactsUrl, contactsInit] = fetchMock.mock.calls[2];
    expect(contactsUrl).toBe("https://www.zohoapis.eu/crm/v2/Contacts");
    expect(contactsInit?.method).toBe("POST");
    expect((contactsInit?.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken tok1");
    expect(JSON.parse(String(contactsInit?.body))).toEqual({
      data: [{ Email: "a@b.com", Last_Name: "A", Account_Name: "Acme" }],
    });

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ bigin_id: "abc123" }));
  });

  it("A20: updates the existing Bigin contact by id instead of creating a duplicate", async () => {
    liveEnv();
    const builder = withContactsUpdate();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "existing123" }] }), { status: 200 })) // search: match found
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ code: "SUCCESS", details: { id: "existing123" }, status: "success" }] }), { status: 200 }));

    await (await freshCrm()).pushContact({ email: "a@b.com" });

    const [updateUrl, updateInit] = fetchMock.mock.calls[2];
    expect(updateUrl).toBe("https://www.zohoapis.eu/crm/v2/Contacts/existing123");
    expect(updateInit?.method).toBe("PUT");
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ bigin_id: "existing123" }));
  });

  it("reuses a cached token across calls instead of refreshing every time", async () => {
    liveEnv();
    withContactsUpdate();
    const contactsBody = JSON.stringify({ data: [{ code: "SUCCESS", details: { id: "x" }, status: "success" }] });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockImplementation(async () => new Response(contactsBody, { status: 200 }));

    const crm = await freshCrm();
    await crm.pushContact({ email: "a@b.com" });
    await crm.pushContact({ email: "b@b.com" });

    expect(fetchMock).toHaveBeenCalledTimes(5); // 1 token fetch + 2 * (1 search + 1 create)
  });

  it("throws when the token refresh is rejected", async () => {
    liveEnv();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad refresh token", { status: 400 }));

    await expect((await freshCrm()).pushContact({ email: "a@b.com" })).rejects.toThrow(/400/);
  });

  it("sync() refreshes the token, pulls Bigin unsubscribes, and stamps last_synced_at for contacts still missing a bigin_id", async () => {
    liveEnv();
    const builder = withContactsUpdate();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // S6: no Bigin-side opt-outs this run

    await (await freshCrm()).sync();

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_synced_at: expect.any(String) }));
    expect(builder.is).toHaveBeenCalledWith("bigin_id", null);
  });

  it("S6: mirrors a Bigin-side opt-out back into contacts via applyOptIn", async () => {
    liveEnv();
    const updateCalls: unknown[] = [];
    let call = 0;
    const from = vi.fn(() => {
      if (call++ === 0) return queryBuilder(dbOk({ id: "c1", subscribed: true, unsubscribed_at: null })); // select by email
      const b = queryBuilder(dbOk(null));
      b.update = vi.fn((payload: unknown) => {
        updateCalls.push(payload);
        return b;
      });
      return b;
    });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ Email: "a@b.com" }] }), { status: 200 }));

    await (await freshCrm()).sync();

    expect(updateCalls[0]).toMatchObject({ subscribed: false, unsubscribed_at: expect.any(String) });
  });

  it("S6: never restamps a contact already unsubscribed locally", async () => {
    liveEnv();
    const firstUnsub = "2026-01-01T00:00:00.000Z";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so mock.calls[i][0] isn't `never`
    const updateSpy = vi.fn((payload: unknown) => builder);
    const builder = queryBuilder(dbOk({ id: "c1", subscribed: false, unsubscribed_at: firstUnsub }));
    builder.update = updateSpy;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ Email: "a@b.com" }] }), { status: 200 }));

    await (await freshCrm()).sync();

    // sync()'s own last_synced_at sweep still runs — assert the never-restamp
    // rule specifically: applyOptIn's { subscribed, unsubscribed_at } shape
    // must never reach update() for a contact already permanently unsubscribed.
    for (const call of updateSpy.mock.calls) {
      expect(call[0]).not.toHaveProperty("subscribed");
    }
  });
});
