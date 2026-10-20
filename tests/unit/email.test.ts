import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The email adapter's whole job is to fail *visibly*. The version this replaced
 * fired the request and never read the response, so an unverified domain came
 * back 403 and was thrown away — the app reported success for mail it had never
 * sent. These tests exist to stop that regressing.
 */

const ENV_KEYS = ["RESEND_API_KEY", "MAILPIT_URL", "EMAIL_FROM", "EMAIL_REPLY_TO"] as const;
const saved: Record<string, string | undefined> = {};

async function freshSender() {
  // getEmailSender reads process.env at call time, but the module is cached
  // between tests; reset so each case gets a clean read.
  vi.resetModules();
  const { getEmailSender } = await import("@/lib/adapters/email");
  return getEmailSender();
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const MAIL = { to: "member@example.test", subject: "Your story is live on SMI", text: "body" };

describe("getEmailSender selection", () => {
  it("prefers Resend when a key is present", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.MAILPIT_URL = "http://127.0.0.1:56324";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await (await freshSender()).send(MAIL);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });

  it("falls back to Mailpit when there is no key", async () => {
    process.env.MAILPIT_URL = "http://127.0.0.1:56324";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ID":"x"}', { status: 200 }));

    await (await freshSender()).send(MAIL);

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:56324/api/v1/send");
  });

  it("falls back to the console when there is neither", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await (await freshSender()).send(MAIL);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});

describe("ResendSender failure handling", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
  });

  it("throws with the status and body on an unverified domain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"statusCode":403,"message":"The sheetmetalindustries.com domain is not verified","name":"validation_error"}', { status: 403 }),
    );

    // The actionable detail is in the body, so it has to reach the error.
    // Assert against one rejection: a Response body can only be read once.
    const error = await (await freshSender())
      .send(MAIL)
      .then(() => null)
      .catch((e: Error) => e);

    expect(error).toMatchObject({ name: "EmailSendError", status: 403 });
    expect(error?.message).toContain("403");
    expect(error?.message).toContain("domain is not verified");
  });

  it("marks a 429 as retryable and honours Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429, headers: { "retry-after": "3" } }),
    );

    await expect((await freshSender()).send(MAIL)).rejects.toMatchObject({
      name: "EmailSendError",
      status: 429,
      retryAfterMs: 3000,
    });
  });

  it("defaults the pause when a 429 carries no Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect((await freshSender()).send(MAIL)).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
  });

  it("lets a network failure propagate rather than swallowing it", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect((await freshSender()).send(MAIL)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("resolves quietly on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"id":"abc"}', { status: 200 }));

    await expect((await freshSender()).send(MAIL)).resolves.toBeUndefined();
  });

  it("sends the configured from and reply_to", async () => {
    process.env.EMAIL_FROM = "SMI <hello@sheetmetalindustries.com>";
    process.env.EMAIL_REPLY_TO = "team@sheetmetalindustries.com";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await (await freshSender()).send(MAIL);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.from).toBe("SMI <hello@sheetmetalindustries.com>");
    expect(body.reply_to).toBe("team@sheetmetalindustries.com");
    expect(body.to).toBe(MAIL.to);
  });
});

describe("MailpitSender", () => {
  beforeEach(() => {
    process.env.MAILPIT_URL = "http://127.0.0.1:56324";
  });

  it("splits a display-name address into Mailpit's shape", async () => {
    process.env.EMAIL_FROM = "SMI <noreply@sheetmetalindustries.com>";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ID":"x"}', { status: 200 }));

    await (await freshSender()).send({ ...MAIL, html: "<p>hi</p>" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.From).toEqual({ Email: "noreply@sheetmetalindustries.com", Name: "SMI" });
    expect(body.To).toEqual([{ Email: MAIL.to }]);
    expect(body.HTML).toBe("<p>hi</p>");
  });

  it("degrades to a log instead of throwing when Mailpit is down", async () => {
    // Dev convenience: unlike Resend, a stopped mail catcher must never break a
    // local flow. Only the production path is allowed to fail the job.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect((await freshSender()).send(MAIL)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});

describe("maskEmail (GDPR.md G6)", () => {
  it("keeps the first letter and the domain, never the whole address", async () => {
    const { maskEmail } = await import("@/lib/adapters/email");
    expect(maskEmail("jane.smith@acme.co.uk")).toBe("j…@acme.co.uk");
    expect(maskEmail("not-an-address")).toBe("…");
  });

  it("the no-key sender logs the masked address", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await (await freshSender()).send({ to: "jane.smith@acme.co.uk", subject: "Hi", text: "x" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("to=j…@acme.co.uk"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("jane.smith@"));
    log.mockRestore();
  });
});
