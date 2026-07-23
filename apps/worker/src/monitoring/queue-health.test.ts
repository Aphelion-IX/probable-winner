import { describe, expect, it } from "vitest";
import { evaluateQueueHealth, QUEUE_STALENESS_THRESHOLD_SECONDS } from "./queue-health.js";

describe("evaluateQueueHealth", () => {
  it("reports healthy when the oldest message is under the threshold", () => {
    const result = evaluateQueueHealth({
      queueName: "catalogue_import",
      queueLength: 3,
      oldestMsgAgeSeconds: 30,
    });

    expect(result.healthy).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("reports healthy when the queue is empty (no oldest message)", () => {
    const result = evaluateQueueHealth({
      queueName: "email",
      queueLength: 0,
      oldestMsgAgeSeconds: null,
    });

    expect(result.healthy).toBe(true);
  });

  it("flags an artificially delayed queue message as unhealthy — the B-202 alert condition", () => {
    const result = evaluateQueueHealth({
      queueName: "search_index",
      queueLength: 12,
      oldestMsgAgeSeconds: QUEUE_STALENESS_THRESHOLD_SECONDS + 61, // just over 6 minutes
    });

    expect(result.healthy).toBe(false);
    expect(result.reason).toContain("exceeding the 300s staleness threshold");
    expect(result.oldestMsgAgeSeconds).toBe(361);
  });

  it("is healthy exactly at the threshold and unhealthy one second past it", () => {
    const atThreshold = evaluateQueueHealth({
      queueName: "pricing_import",
      queueLength: 1,
      oldestMsgAgeSeconds: QUEUE_STALENESS_THRESHOLD_SECONDS,
    });
    const pastThreshold = evaluateQueueHealth({
      queueName: "pricing_import",
      queueLength: 1,
      oldestMsgAgeSeconds: QUEUE_STALENESS_THRESHOLD_SECONDS + 1,
    });

    expect(atThreshold.healthy).toBe(true);
    expect(pastThreshold.healthy).toBe(false);
  });

  it("respects a custom threshold", () => {
    const result = evaluateQueueHealth(
      { queueName: "order_processing", queueLength: 1, oldestMsgAgeSeconds: 45 },
      30,
    );

    expect(result.healthy).toBe(false);
  });
});
