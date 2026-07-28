import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

import { processPriceAlertCheck, processRestockAlertCheck } from "./notify-alert-subscribers.js";
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

const skuContextRow = {
  card_printing_id: "printing-1",
  finish_code: "nonfoil",
  condition_code: "nm",
  card_name: "Lightning Bolt",
  set_name: "Alpha",
};

describe("processRestockAlertCheck", () => {
  let emailProvider: EmailProvider;
  let sendEmail: ReturnType<typeof vi.fn<EmailProvider["sendEmail"]>>;

  beforeEach(() => {
    sendEmail = vi.fn().mockResolvedValue(undefined);
    emailProvider = { sendEmail };
  });

  it("does nothing when no stock is currently available", async () => {
    const { sql, calls } = createMockSql([[{ total_available: "0" }]]);

    const notified = await processRestockAlertCheck(sql, emailProvider, "sku-1");

    expect(notified).toBe(0);
    expect(calls).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails matching active alerts, translating finish/condition to the alert vocabulary", async () => {
    const { sql, calls } = createMockSql([
      [{ total_available: "3" }],
      [skuContextRow],
      [{ id: "alert-1", customer_id: "customer-1" }],
      [{ email: "buyer@example.com" }],
      [],
    ]);

    const notified = await processRestockAlertCheck(sql, emailProvider, "sku-1");

    expect(notified).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        subject: "Back in stock: Lightning Bolt",
      }),
    );
    // finish/condition query uses the translated 'normal'/'NM' vocabulary,
    // not the raw sellable_skus 'nonfoil'/'nm' codes.
    expect(calls[2].values).toEqual(["printing-1", "normal", "NM"]);
    expect(calls[4].text).toContain("update restock_alerts");
  });

  it("skips a match with no resolvable customer email, without throwing", async () => {
    const { sql } = createMockSql([
      [{ total_available: "1" }],
      [skuContextRow],
      [{ id: "alert-1", customer_id: "customer-1" }],
      [{ email: null }],
    ]);

    const notified = await processRestockAlertCheck(sql, emailProvider, "sku-1");

    expect(notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 0 when the sku no longer resolves to a printing", async () => {
    const { sql } = createMockSql([[{ total_available: "2" }], []]);

    const notified = await processRestockAlertCheck(sql, emailProvider, "sku-missing");

    expect(notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("processPriceAlertCheck", () => {
  let emailProvider: EmailProvider;
  let sendEmail: ReturnType<typeof vi.fn<EmailProvider["sendEmail"]>>;

  beforeEach(() => {
    sendEmail = vi.fn().mockResolvedValue(undefined);
    emailProvider = { sendEmail };
  });

  it("emails alerts whose threshold is at or above the published price", async () => {
    const { sql, calls } = createMockSql([
      [skuContextRow],
      [{ id: "alert-1", customer_id: "customer-1", alert_price: 25 }],
      [{ email: "buyer@example.com" }],
      [],
    ]);

    const notified = await processPriceAlertCheck(sql, emailProvider, "sku-1", 20.15, "AUD");

    expect(notified).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "buyer@example.com", subject: "Price drop: Lightning Bolt" }),
    );
    expect(calls[1].values).toEqual(["printing-1", "normal", "AUD", 20.15]);
  });

  it("returns 0 when the sku no longer resolves to a printing", async () => {
    const { sql } = createMockSql([[]]);

    const notified = await processPriceAlertCheck(sql, emailProvider, "sku-1", 20.15, "AUD");

    expect(notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
