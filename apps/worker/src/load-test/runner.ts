import type { Sample } from "./metrics.js";

export interface RunOptions {
  concurrency: number;
  iterations: number;
}

/**
 * Runs `task` `iterations` times across `concurrency` parallel workers,
 * recording per-call latency and success/failure. Each worker pulls the
 * next iteration off a shared counter rather than being pre-assigned a
 * fixed slice, so a few slow calls don't leave other workers idle.
 */
export async function runLoad(
  task: (iteration: number) => Promise<void>,
  options: RunOptions,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const iteration = next++;
      if (iteration >= options.iterations) return;

      const start = performance.now();
      try {
        await task(iteration);
        samples.push({ durationMs: performance.now() - start, ok: true });
      } catch (err) {
        samples.push({
          durationMs: performance.now() - start,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers = Array.from({ length: options.concurrency }, () => worker());
  await Promise.all(workers);

  return samples;
}
