import { sql } from "../db.js";
import { snapshotDbHealth } from "./db-metrics.js";
import { SCENARIOS, type ScenarioName, type ScenarioResult } from "./scenarios.js";

const BUDGETS_NOTE =
  "Compare medianMs/p95Ms against docs/performance.md's Load Test Scenarios section and Database Query Performance table.";

function formatResult(result: ScenarioResult): string {
  if (result.blocked) {
    return `${result.name}: BLOCKED — ${result.blocked}`;
  }
  const s = result.stats!;
  const lines = [
    `${result.name}:`,
    `  count=${s.count} errors=${s.errorCount} (${(s.errorRate * 100).toFixed(1)}%)`,
    `  median=${s.medianMs.toFixed(1)}ms p95=${s.p95Ms.toFixed(1)}ms p99=${s.p99Ms.toFixed(1)}ms min=${s.minMs.toFixed(1)}ms max=${s.maxMs.toFixed(1)}ms`,
  ];
  if (result.notes) lines.push(`  ${result.notes}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2) as ScenarioName[];
  const names = (
    requested.length > 0 ? requested : (Object.keys(SCENARIOS) as ScenarioName[])
  ).filter((name): name is ScenarioName => name in SCENARIOS);

  if (names.length === 0) {
    console.error(`No matching scenarios. Available: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }

  console.log(
    `Running ${names.length} scenario(s) against ${new URL(process.env.DATABASE_URL!).hostname}\n`,
  );

  const before = await snapshotDbHealth(sql).catch((err) => {
    console.warn(
      "Could not snapshot DB health before run:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  });
  if (before) {
    console.log(
      `DB health before run: cache hit rate ${(before.cacheHitRate * 100).toFixed(2)}%, queue delay (sec) ${JSON.stringify(before.queueDelaySec)}\n`,
    );
  }

  const results: ScenarioResult[] = [];
  let hadFailure = false;

  for (const name of names) {
    const runner = SCENARIOS[name];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each scenario's arg list differs (some take a Sql client, some don't); the registry type intentionally erases that for uniform dispatch here.
    const result: ScenarioResult = await (runner as any)(sql);
    results.push(result);
    console.log(formatResult(result));
    console.log("");
    if (result.stats && result.stats.errorRate > 0.05) hadFailure = true;
  }

  const after = await snapshotDbHealth(sql).catch(() => undefined);

  if (after) {
    console.log("DB health after run:");
    console.log(`  cache hit rate: ${(after.cacheHitRate * 100).toFixed(2)}%`);
    console.log(`  queue delay (sec): ${JSON.stringify(after.queueDelaySec)}`);
    if (after.slowestStatements.length > 0) {
      console.log("  slowest statements:");
      for (const stmt of after.slowestStatements.slice(0, 5)) {
        console.log(`    ${stmt.meanExecMs.toFixed(1)}ms avg (${stmt.calls} calls): ${stmt.query}`);
      }
    }
    console.log("");
  }

  console.log(BUDGETS_NOTE);

  await sql.end();
  process.exit(hadFailure ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
