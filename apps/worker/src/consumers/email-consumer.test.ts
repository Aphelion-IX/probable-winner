import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

const mockSendOrderConfirmationEmail = vi.fn();
const mockSendShipmentNotificationEmail = vi.fn();
const mockCreateEmailProviderFromEnv = vi.fn();

vi.mock("../jobs/send-order-confirmation-email.js", () => ({
  sendOrderConfirmationEmail: (...args: unknown[]) => mockSendOrderConfirmationEmail(...args),
}));

vi.mock("../jobs/send-shipment-notification-email.js", () => ({
  sendShipmentNotificationEmail: (...args: unknown[]) => mockSendShipmentNotificationEmail(...args),
}));

vi.mock("../integrations/email/resend-provider.js", () => ({
  createEmailProviderFromEnv: () => mockCreateEmailProviderFromEnv(),
}));

type MockCall = { text: string; values: unknown[] };

function createMockSql(responses: unknown[][]): { sql: Sql; calls: MockCall[] } {
  const calls: MockCall[] = [];
  let index = 0;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    const response = responses[index] ?? [];
    index += 1;
    return Promise.resolve(response);
  }) as unknown as Sql;

  return { sql, calls };
}

describe("pollEmailQueue", () => {
  beforeEach(() => {
    mockSendOrderConfirmationEmail.mockReset();
    mockSendShipmentNotificationEmail.mockReset();
    mockCreateEmailProviderFromEnv.mockReset();
    mockCreateEmailProviderFromEnv.mockReturnValue({ sendEmail: vi.fn() });
  });

  it("returns false when the queue is empty", async () => {
    const { sql, calls } = createMockSql([[]]);
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(false);
    expect(calls).toHaveLength(1);
    expect(mockSendOrderConfirmationEmail).not.toHaveBeenCalled();
  });

  it("sends an order_confirmation email and archives the message", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 1, message: { emailType: "order_confirmation", orderId: "order-1" } }],
      [],
    ]);
    mockSendOrderConfirmationEmail.mockResolvedValue(true);
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(true);
    expect(mockSendOrderConfirmationEmail).toHaveBeenCalledWith(sql, expect.anything(), "order-1");
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("sends a shipment_notification email and archives the message", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 5, message: { emailType: "shipment_notification", orderId: "order-2" } }],
      [],
    ]);
    mockSendShipmentNotificationEmail.mockResolvedValue(true);
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(true);
    expect(mockSendShipmentNotificationEmail).toHaveBeenCalledWith(sql, expect.anything(), "order-2");
    expect(mockSendOrderConfirmationEmail).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("archives without processing an unrecognised emailType", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 2, message: { emailType: "newsletter", orderId: "order-1" } }],
    ]);
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(true);
    expect(mockSendOrderConfirmationEmail).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("archives without processing when orderId is missing", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 3, message: { emailType: "order_confirmation" } }],
    ]);
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(true);
    expect(mockSendOrderConfirmationEmail).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("leaves the message in the queue (no archive) when sending throws", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 4, message: { emailType: "order_confirmation", orderId: "order-1" } }],
    ]);
    mockSendOrderConfirmationEmail.mockRejectedValue(new Error("resend unreachable"));
    const { pollEmailQueue } = await import("./email-consumer.js");

    const result = await pollEmailQueue(sql);

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.text.includes("pgmq.archive"))).toBe(false);
  });
});
