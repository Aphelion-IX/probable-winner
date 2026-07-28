import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

import { sendOrderConfirmationEmail } from "./send-order-confirmation-email.js";
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

const ORDER = {
  order_number: "ORD-1001",
  total_amount: 25.5,
  currency: "AUD",
  fulfilment_type: "online_shipping",
  customer_id: "customer-1",
  guest_email: null,
};

const LINES = [{ card_name: "Lightning Bolt", quantity: 2, line_total: 25.5 }];

describe("sendOrderConfirmationEmail", () => {
  let emailProvider: EmailProvider;
  let sendEmail: ReturnType<typeof vi.fn<EmailProvider["sendEmail"]>>;

  beforeEach(() => {
    sendEmail = vi.fn().mockResolvedValue(undefined);
    emailProvider = { sendEmail };
  });

  it("returns false without sending when the order no longer exists", async () => {
    const { sql } = createMockSql([[]]);

    const sent = await sendOrderConfirmationEmail(sql, emailProvider, "order-missing");

    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails the authenticated customer's account email, not any guest_email column value", async () => {
    const { sql } = createMockSql([
      [{ ...ORDER, guest_email: "stale@example.com" }],
      [{ email: "customer@example.com" }],
      LINES,
    ]);

    const sent = await sendOrderConfirmationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: "Order confirmed: #ORD-1001",
      }),
    );
  });

  it("emails a guest's captured guest_email when there is no customer_id", async () => {
    const { sql } = createMockSql([
      [{ ...ORDER, customer_id: null, guest_email: "guest@example.com" }],
      LINES,
    ]);

    const sent = await sendOrderConfirmationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "guest@example.com" }));
  });

  it("returns false without sending when a guest order has no captured email", async () => {
    const { sql } = createMockSql([[{ ...ORDER, customer_id: null, guest_email: null }]]);

    const sent = await sendOrderConfirmationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns false without sending when the customer's auth.users row has no email", async () => {
    const { sql } = createMockSql([[ORDER], [{ email: null }]]);

    const sent = await sendOrderConfirmationEmail(sql, emailProvider, "order-1");

    expect(sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("includes every order line and the fulfilment type in the email body", async () => {
    const { sql } = createMockSql([
      [{ ...ORDER, fulfilment_type: "click_and_collect" }],
      [{ email: "customer@example.com" }],
      [
        { card_name: "Lightning Bolt", quantity: 2, line_total: 10 },
        { card_name: "Counterspell", quantity: 1, line_total: 15.5 },
      ],
    ]);

    await sendOrderConfirmationEmail(sql, emailProvider, "order-1");

    const call = sendEmail.mock.calls[0][0];
    expect(call.text).toContain("2 x Lightning Bolt - AUD 10.00");
    expect(call.text).toContain("1 x Counterspell - AUD 15.50");
    expect(call.text).toContain("Click and collect");
    expect(call.html).toContain("Lightning Bolt");
  });
});
