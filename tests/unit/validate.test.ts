import { describe, expect, it } from "vitest";
import { parsePhone, safeInternalPath, UUID_RE } from "@/lib/validate";

describe("safeInternalPath", () => {
  it("accepts plain internal paths, with or without query strings", () => {
    expect(safeInternalPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/console/members?created=1")).toBe("/console/members?created=1");
    expect(safeInternalPath("/")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeInternalPath("https://evil.test/console")).toBeNull();
    expect(safeInternalPath("http://evil.test")).toBeNull();
    expect(safeInternalPath("javascript:alert(1)")).toBeNull();
  });

  it("rejects protocol-relative and backslash-tricked paths", () => {
    expect(safeInternalPath("//evil.test/console")).toBeNull();
    expect(safeInternalPath("/\\evil.test")).toBeNull();
  });

  it("rejects non-strings and empty values", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath("dashboard")).toBeNull();
  });
});

describe("parsePhone", () => {
  it("accepts common UK and international formats, trimmed", () => {
    expect(parsePhone("0161 555 0100")).toBe("0161 555 0100");
    expect(parsePhone("0121 000 0000")).toBe("0121 000 0000");
    expect(parsePhone(" +44 (0)161 555-0100 ")).toBe("+44 (0)161 555-0100");
  });

  it("treats blank as null", () => {
    expect(parsePhone("")).toBeNull();
    expect(parsePhone("   ")).toBeNull();
  });

  it("rejects letters, extensions and misplaced plus signs", () => {
    expect(parsePhone("call me maybe")).toMatchObject({ error: expect.stringContaining("Phone number") });
    expect(parsePhone("555.770.7727 x1234")).toMatchObject({ error: expect.any(String) });
    expect(parsePhone("0161+555+0100")).toMatchObject({ error: expect.any(String) });
  });

  it("rejects too few or too many digits", () => {
    expect(parsePhone("123456")).toMatchObject({ error: expect.any(String) });
    expect(parsePhone("1234567890123456")).toMatchObject({ error: expect.any(String) });
    expect(parsePhone("1234567")).toBe("1234567");
    expect(parsePhone("+123456789012345")).toBe("+123456789012345");
  });
});

describe("UUID_RE", () => {
  it("matches canonical uuids case-insensitively", () => {
    expect(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(UUID_RE.test("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects PostgREST filter-syntax injection attempts", () => {
    expect(UUID_RE.test("x,entity_id.not.is.null")).toBe(false);
    expect(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000,id.gt.0")).toBe(false);
    expect(UUID_RE.test("")).toBe(false);
  });
});
