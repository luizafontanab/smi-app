import { afterEach, describe, expect, it, vi } from "vitest";

const { recordError } = vi.hoisted(() => ({ recordError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ recordError }));

import { isControlFlow, onRequestError } from "@/instrumentation";

const request = { path: "/news/a-story?utm=x", method: "GET", headers: { "user-agent": "UA" } };
const context = { routerKind: "App Router", routePath: "/news/[slug]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined, renderType: "dynamic" } as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("onRequestError (docs/logging.md)", () => {
  it("records a real server error with its route, path and digest", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const err = Object.assign(new Error("boom"), { digest: "123456" });
    await onRequestError(err, request, context as never);
    expect(recordError).toHaveBeenCalledWith(expect.objectContaining({
      source: "server",
      area: "render:/news/[slug]",
      path: "/news/a-story?utm=x", // stripped by the logger, see log.test.ts
      digest: "123456",
      context: expect.objectContaining({ method: "GET", ua: "UA" }),
    }));
  });

  it("skips redirect() and notFound(), which Next implements by throwing", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    expect(isControlFlow({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toBe(true);
    expect(isControlFlow({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
    expect(isControlFlow(new Error("real"))).toBe(false);
    await onRequestError({ digest: "NEXT_REDIRECT;push;/x;303;" }, request, context as never);
    expect(recordError).not.toHaveBeenCalled();
  });

  it("only prints on the edge runtime, where the logger can't run", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    await onRequestError(new Error("edge boom"), request, context as never);
    expect(recordError).not.toHaveBeenCalled();
    expect(consoleErr).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] /));
  });

  it("never throws, even if recording does", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    recordError.mockRejectedValueOnce(new Error("broken"));
    await expect(onRequestError(new Error("x"), request, context as never)).resolves.toBeUndefined();
  });
});
