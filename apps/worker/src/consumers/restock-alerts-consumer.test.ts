import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

const mockProcessRestockAlertCheck = vi.fn();
const mockProcessPriceAlertCheck = vi.fn();
const mockCreateEmailProviderFromEnv = vi.fn();

vi.mock("../jobs/notify-alert-subscribers.js", () => ({
  processRestockAlertCheck: (...args: unknown[]) => mockProcessRestockAlertCheck(...args),
  processPriceAlertCheck: (...args: unknown[]) => mockProcessPriceAlertCheck(...args),
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

describe("pollRestockAlertsQueue", () => {
  beforeEach(() => {
    mockProcessRestockAlertCheck.mockReset();
    mockProcessPriceAlertCheck.mockReset();
    mockCreateEmailProviderFromEnv.mockReset();
    mockCreateEmailProviderFromEnv.mockReturnValue({ sendEmail: vi.fn() });
  });

  it("returns false when the queue is empty", async () => {
    const { sql, calls } = createMockSql([[]]);
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(false);
    expect(calls).toHaveLength(1);
    expect(mockProcessRestockAlertCheck).not.toHaveBeenCalled();
  });

  it("runs a restock check by default (no checkType) and archives the message", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 1, message: { sellableSkuId: "sku-1" } }],
      [],
    ]);
    mockProcessRestockAlertCheck.mockResolvedValue(2);
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(true);
    expect(mockProcessRestockAlertCheck).toHaveBeenCalledWith(sql, expect.anything(), "sku-1");
    expect(mockProcessPriceAlertCheck).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("runs a price check when checkType is 'price'", async () => {
    const { sql, calls } = createMockSql([
      [
        {
          msg_id: 2,
          message: { checkType: "price", sellableSkuId: "sku-2", finalAmount: 20.15, currency: "AUD" },
        },
      ],
      [],
    ]);
    mockProcessPriceAlertCheck.mockResolvedValue(1);
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(true);
    expect(mockProcessPriceAlertCheck).toHaveBeenCalledWith(
      sql,
      expect.anything(),
      "sku-2",
      20.15,
      "AUD",
    );
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("archives without processing when sellableSkuId is missing", async () => {
    const { sql, calls } = createMockSql([[{ msg_id: 3, message: {} }]]);
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(true);
    expect(mockProcessRestockAlertCheck).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("archives without processing when a price check is missing finalAmount/currency", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 4, message: { checkType: "price", sellableSkuId: "sku-4" } }],
    ]);
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(true);
    expect(mockProcessPriceAlertCheck).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("leaves the message in the queue (no archive) when the check throws", async () => {
    const { sql, calls } = createMockSql([[{ msg_id: 5, message: { sellableSkuId: "sku-5" } }]]);
    mockProcessRestockAlertCheck.mockRejectedValue(new Error("resend unreachable"));
    const { pollRestockAlertsQueue } = await import("./restock-alerts-consumer.js");

    const result = await pollRestockAlertsQueue(sql);

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.text.includes("pgmq.archive"))).toBe(false);
  });
});
