import type { Sql } from "postgres";

// B-202: import failure monitoring across the two import pipelines that
// exist today (catalogue and pricing). Looks back a rolling window rather
// than "since last check" so a restart of the worker never silently skips
// a window of failures.
export const IMPORT_FAILURE_LOOKBACK_HOURS = 24;

export interface ImportFailureSummary {
  source: "catalogue_import" | "pricing_import";
  failedRunCount: number;
  mostRecentFailureAt: Date | null;
}

interface FailedRunRow {
  failed_count: number;
  most_recent: Date | null;
}

export async function checkImportFailures(
  sql: Sql,
  lookbackHours: number = IMPORT_FAILURE_LOOKBACK_HOURS,
): Promise<ImportFailureSummary[]> {
  const [catalogueRow] = await sql<FailedRunRow[]>`
    select count(*)::int as failed_count, max(started_at) as most_recent
    from catalogue_import_runs
    where status = 'failed' and started_at > now() - make_interval(hours => ${lookbackHours})
  `;

  const [pricingRow] = await sql<FailedRunRow[]>`
    select count(*)::int as failed_count, max(started_at) as most_recent
    from price_import_runs
    where status = 'failed' and started_at > now() - make_interval(hours => ${lookbackHours})
  `;

  return [
    {
      source: "catalogue_import",
      failedRunCount: catalogueRow?.failed_count ?? 0,
      mostRecentFailureAt: catalogueRow?.most_recent ?? null,
    },
    {
      source: "pricing_import",
      failedRunCount: pricingRow?.failed_count ?? 0,
      mostRecentFailureAt: pricingRow?.most_recent ?? null,
    },
  ];
}
