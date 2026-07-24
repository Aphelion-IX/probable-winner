import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

import { extractSkuId } from "./search-index-consumer.js";

const mockUpdateSearchDocument = vi.fn();

vi.mock("../jobs/update-search-document.js", () => ({
  updateSearchDocument: (...args: unknown[]) => mockUpdateSearchDocument(...args),
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

describe("extractSkuId", () => {
  it("reads the sellableSkuId key from an event payload", () => {
    expect(extractSkuId({ sellableSkuId: "sku-1" })).toBe("sku-1");
  });

  it("returns null when the payload has no sellableSkuId", () => {
    expect(extractSkuId({ somethingElse: "x" })).toBeNull();
  });

  it("returns null (not throw) for a non-string sellableSkuId", () => {
    expect(extractSkuId({ sellableSkuId: 123 })).toBeNull();
  });
});

describe("pollSearchIndexQueue", () => {
  beforeEach(() => {
    mockUpdateSearchDocument.mockReset();
  });

  it("returns false without any further work when the queue is empty", async () => {
    const { sql, calls } = createMockSql([[]]);
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(false);
    expect(calls).toHaveLength(1);
    expect(mockUpdateSearchDocument).not.toHaveBeenCalled();
  });

  it("updates the affected SKU's document and archives the message", async () => {
    const { sql, calls } = createMockSql([
      [
        {
          msg_id: 1,
          message: { integrationEventId: "event-1", eventType: "inventory_balance_changed" },
        },
      ],
      [
        {
          id: "event-1",
          event_type: "inventory_balance_changed",
          payload: { sellableSkuId: "sku-1" },
        },
      ],
      [],
    ]);
    mockUpdateSearchDocument.mockResolvedValue(true);
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(true);
    expect(mockUpdateSearchDocument).toHaveBeenCalledWith(sql, "sku-1");
    // Third call is the pgmq.archive.
    expect(calls[2].text).toContain("pgmq.archive");
  });

  it("archives without processing when the integration_event no longer exists", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 2, message: { integrationEventId: "missing-event" } }],
      [],
    ]);
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(true);
    expect(mockUpdateSearchDocument).not.toHaveBeenCalled();
    expect(calls[2].text).toContain("pgmq.archive");
  });

  it("archives without processing when the message is missing integrationEventId", async () => {
    const { sql, calls } = createMockSql([[{ msg_id: 3, message: {} }]]);
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(true);
    expect(mockUpdateSearchDocument).not.toHaveBeenCalled();
    expect(calls[1].text).toContain("pgmq.archive");
  });

  it("archives an event whose payload has no resolvable SKU, without calling updateSearchDocument", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 4, message: { integrationEventId: "event-4" } }],
      [{ id: "event-4", event_type: "something_else", payload: {} }],
      [],
    ]);
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(true);
    expect(mockUpdateSearchDocument).not.toHaveBeenCalled();
    expect(calls[2].text).toContain("pgmq.archive");
  });

  it("leaves the message in the queue (no archive) when updateSearchDocument throws", async () => {
    const { sql, calls } = createMockSql([
      [{ msg_id: 5, message: { integrationEventId: "event-5" } }],
      [
        {
          id: "event-5",
          event_type: "inventory_balance_changed",
          payload: { sellableSkuId: "sku-5" },
        },
      ],
    ]);
    mockUpdateSearchDocument.mockRejectedValue(new Error("typesense unreachable"));
    const { pollSearchIndexQueue } = await import("./search-index-consumer.js");

    const result = await pollSearchIndexQueue(sql);

    expect(result).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.text.includes("pgmq.archive"))).toBe(false);
  });
});
