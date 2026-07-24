import { describe, it, expect } from "vitest";
import { runLoad } from "./runner.js";

describe("runLoad", () => {
  it("runs exactly `iterations` calls regardless of concurrency", async () => {
    let calls = 0;
    const samples = await runLoad(
      async () => {
        calls++;
      },
      { concurrency: 4, iterations: 17 },
    );
    expect(calls).toBe(17);
    expect(samples).toHaveLength(17);
  });

  it("records failures as ok:false without stopping other workers", async () => {
    const samples = await runLoad(
      async (i) => {
        if (i % 3 === 0) throw new Error(`boom ${i}`);
      },
      { concurrency: 3, iterations: 9 },
    );
    expect(samples).toHaveLength(9);
    const failures = samples.filter((s) => !s.ok);
    expect(failures).toHaveLength(3);
    expect(failures.every((f) => f.error?.startsWith("boom"))).toBe(true);
  });

  it("runs concurrently, not sequentially", async () => {
    const delayMs = 20;
    const start = performance.now();
    await runLoad(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      },
      { concurrency: 10, iterations: 10 },
    );
    const elapsed = performance.now() - start;
    // Sequential would take ~200ms; concurrent (10 workers, 10 iterations)
    // should take close to one delay's worth. Generous bound for CI jitter.
    expect(elapsed).toBeLessThan(delayMs * 5);
  });
});
