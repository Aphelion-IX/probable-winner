import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

import { sendShipmentNotificationEmail } from "./send-shipment-notification-email.js";
import type { EmailProvider } from "../integrations/email/types.js";

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

const ORDER = { order_number: "ORD-2002", customer_id: "customer-1", guest_email: null };

describe("sendShipmentNotificationEmail", () => {
  let emailProvider: EmailProvider;
  let sendEmail: ReturnType<typeof vi.fn<EmailProvider["sendEmail"]>>;

  beforeEach(() => {
    sendEmail = vi.fn().mockResolvedValue(undefined);
    emailProvider = { sendEmail };
  });

  it("returns false without sending when the order no longer exists", async () => {
    const { sql } = createMockSql([[]]);

    const sent = await sendShipmentNotificationEmail(sql, emailProvider, "order-missing");

    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns false without sending when there is no recipient email", async () => {
    const { sql } = createMockSql([[{ order_number: "ORD-2002", customer_id: null, guest_email: null }]]);

    const sent = await sendShipmentNotificationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("includes the tracking number and carrier when a shipment row exists", async () => {
    const { sql } = createMockSql([
      [ORDER],
      [{ email: "customer@example.com" }],
      [{ tracking_number: "TRK123", carrier: "auspost" }],
    ]);

    const sent = await sendShipmentNotificationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(true);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("customer@example.com");
    expect(call.subject).toBe("Your order has shipped: #ORD-2002");
    expect(call.text).toContain("Tracking number: TRK123 (auspost)");
  });

  it("still sends a notification without tracking details when none are recorded", async () => {
    const { sql } = createMockSql([[ORDER], [{ email: "customer@example.com" }], []]);

    const sent = await sendShipmentNotificationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(true);
    expect(sendEmail.mock.calls[0][0].text).not.toContain("Tracking number");
  });

  it("emails a guest's captured guest_email when there is no customer_id", async () => {
    const { sql } = createMockSql([
      [{ order_number: "ORD-2002", customer_id: null, guest_email: "guest@example.com" }],
      [{ tracking_number: null, carrier: null }],
    ]);

    const sent = await sendShipmentNotificationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "guest@example.com" }));
  });
});
