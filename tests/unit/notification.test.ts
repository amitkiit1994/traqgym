import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/settings", () => {
  const store = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string, def: string) => Promise.resolve(store.get(key) ?? def)),
    setSetting: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    listEncryptedKeys: vi.fn(() => []),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("notification service", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.resetModules();
    // Clear the in-memory settings store between tests so configuration
    // set in one test doesn't bleed into another.
    const settings = (await import("@/lib/services/settings")) as unknown as {
      setSetting: (k: string, v: string) => Promise<void>;
    };
    await settings.setSetting("msg91_auth_key", "");
    await settings.setSetting("msg91_sender_id", "");
    await settings.setSetting("msg91_whatsapp_number", "");
    await settings.setSetting("smtp_host", "");
    await settings.setSetting("smtp_user", "");
    await settings.setSetting("smtp_pass", "");
  });

  it("sendSMS calls MSG91 with configured auth key", async () => {
    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("msg91_auth_key", "test-key");
    await setSetting("msg91_sender_id", "FFFGYM");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ type: "success" }) } as Response);

    const { sendSMS } = await import("@/lib/services/notification");
    const res = await sendSMS({ to: "9819811652", message: "Test" });
    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain("msg91.com");
  });

  it("sendSMS returns success=false (graceful) when MSG91 not configured", async () => {
    const { sendSMS } = await import("@/lib/services/notification");
    const res = await sendSMS({ to: "9819811652", message: "Test" });
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true); // skipped, not errored
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendEmail returns skipped when SMTP not configured", async () => {
    const { sendEmail } = await import("@/lib/services/notification");
    const res = await sendEmail({ to: "test@test.com", subject: "x", body: "x" });
    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true);
  });

  it("normalizePhone strips +91 prefix and validates length", async () => {
    const { normalizePhone } = await import("@/lib/services/notification");
    expect(normalizePhone("9819811652")).toBe("9819811652");
    expect(normalizePhone("+919819811652")).toBe("9819811652");
    expect(normalizePhone("91 98198 11652")).toBe("9819811652");
    expect(normalizePhone("12345")).toBe(null); // too short
    expect(normalizePhone("")).toBe(null);
  });
});
