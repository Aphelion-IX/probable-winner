import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResendEmailError,
  ResendEmailProvider,
  createEmailProviderFromEnv,
} from "./resend-provider.js";

describe("ResendEmailProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the message to Resend's API with the configured from address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ResendEmailProvider("test-key", "Alerts <alerts@example.com>");
    await provider.sendEmail({
      to: "buyer@example.com",
      subject: "Back in stock",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      from: "Alerts <alerts@example.com>",
      to: "buyer@example.com",
      subject: "Back in stock",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("throws ResendEmailError with the response body on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 422, text: async () => "invalid from address" }),
    );

    const provider = new ResendEmailProvider("test-key", "bad-from");

    await expect(
      provider.sendEmail({ to: "buyer@example.com", subject: "x", html: "x", text: "x" }),
    ).rejects.toThrow(ResendEmailError);
  });
});

describe("createEmailProviderFromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when RESEND_API_KEY or RESEND_FROM_EMAIL is not configured", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    expect(() => createEmailProviderFromEnv()).toThrow(/RESEND_API_KEY/);
  });

  it("builds a ResendEmailProvider when both env vars are set", () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "Alerts <alerts@example.com>";

    expect(createEmailProviderFromEnv()).toBeInstanceOf(ResendEmailProvider);
  });
});
