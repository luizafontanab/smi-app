import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUploadSlot } from "@/app/uploads/actions";
import { serviceDb } from "@/lib/db/server";
import { UPLOAD_RATE_LIMITED, UPLOAD_SIGNED_OUT } from "@/lib/upload-limits";
import { asDb, dbOk, mockDb } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser }));

afterEach(() => {
  resetDbServerMocks();
  currentUser.mockReset();
});

function stubSigning() {
  const createSignedUploadUrl = vi.fn(async (path: string) => dbOk({ signedUrl: `http://127.0.0.1:56321/sign/${path}?token=t`, path, token: "t" }));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: vi.fn(() => ({ createSignedUploadUrl })) } })));
  return createSignedUploadUrl;
}

const member = (memberId: string) => ({ userId: `u-${memberId}`, email: "m@x", role: "member", memberId, displayName: null });
const image = { kind: "image" as const, size: 6_000_000, type: "image/jpeg" };

describe("requestUploadSlot", () => {
  it("refuses a signed-out caller as a value — never a redirect away from the unsaved form", async () => {
    const sign = stubSigning();
    currentUser.mockResolvedValue(null);
    expect(await requestUploadSlot(image)).toEqual({ error: UPLOAD_SIGNED_OUT });
    expect(sign).not.toHaveBeenCalled();
  });

  it("puts a member's upload under their own prefix, whatever the request says", async () => {
    stubSigning();
    const id = randomUUID();
    currentUser.mockResolvedValue(member(id));
    const slot = await requestUploadSlot(image);
    expect("path" in slot && slot.path).toMatch(new RegExp(`^members/${id}/[0-9a-f-]{36}\\.jpg$`));
  });

  it("puts an admin's under the console prefix", async () => {
    stubSigning();
    currentUser.mockResolvedValue({ userId: `admin-${randomUUID()}`, email: "a@x", role: "admin", memberId: null, displayName: null });
    const slot = await requestUploadSlot({ kind: "pdf", size: 15 * 1024 * 1024, type: "application/pdf" });
    expect("path" in slot && slot.path).toMatch(/^console\/[0-9a-f-]{36}\.pdf$/);
  });

  it("refuses a malformed request without signing anything", async () => {
    const sign = stubSigning();
    currentUser.mockResolvedValue(member(randomUUID()));
    for (const bad of [{ ...image, kind: "html" }, { ...image, size: -1 }, { ...image, size: Number.NaN }, null]) {
      expect(await requestUploadSlot(bad as never)).toEqual({ error: expect.any(String) });
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("rate-limits one uploader, and only that one", async () => {
    stubSigning();
    const busy = member(randomUUID());
    currentUser.mockResolvedValue(busy);
    const results = [];
    for (let i = 0; i < 121; i++) results.push(await requestUploadSlot(image));
    expect(results.slice(0, 120).every((r) => "path" in r)).toBe(true);
    expect(results[120]).toEqual({ error: UPLOAD_RATE_LIMITED });

    currentUser.mockResolvedValue(member(randomUUID()));
    expect("path" in (await requestUploadSlot(image))).toBe(true);
  });
});
