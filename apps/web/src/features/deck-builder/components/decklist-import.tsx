"use client";

import { useState } from "react";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  importDecklist,
  type DecklistImportLine,
  type DecklistImportResult,
} from "@/features/deck-builder/actions/match-decklist";
import { getSubstitutions } from "@/features/deck-builder/actions/get-substitutions";
import type { SubstitutionOutcome } from "@/features/deck-builder/lib/resolve-substitution";
import type { SubstitutionCandidate } from "@/features/deck-builder/queries/get-substitution-candidates";

type Status = "idle" | "loading" | "done" | "error";

// Matches the fixed seed data in supabase/migrations (sellable_skus.sql):
// conditions.sort_order runs nm=1 .. dmg=5, best to worst.
const CONDITIONS = [
  { code: "nm", name: "Near Mint", sortOrder: 1 },
  { code: "lp", name: "Lightly Played", sortOrder: 2 },
  { code: "mp", name: "Moderately Played", sortOrder: 3 },
  { code: "hp", name: "Heavily Played", sortOrder: 4 },
  { code: "dmg", name: "Damaged", sortOrder: 5 },
];

const priceFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function initialSelections(result: DecklistImportResult): Record<number, string> {
  const selections: Record<number, string> = {};
  result.lines.forEach((line, index) => {
    if (line.candidates.length === 1) {
      selections[index] = line.candidates[0].printingId;
    }
  });
  return selections;
}

function SubstitutionNote({
  outcome,
}: {
  outcome: SubstitutionOutcome<SubstitutionCandidate> | undefined;
}) {
  if (!outcome) return null;

  if (outcome.status === "unavailable") {
    return (
      <p
        className="mt-1 flex items-center gap-1 text-xs text-destructive"
        data-testid="substitution-note"
      >
        <CircleAlert className="size-3" aria-hidden />
        Not currently available in stock.
      </p>
    );
  }

  const price = priceFormatter.format(outcome.sku.price);
  const location = `${outcome.sku.setName} #${outcome.sku.collectorNumber} · ${outcome.sku.conditionCode.toUpperCase()}`;

  if (outcome.status === "preferred") {
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid="substitution-note">
        {price} · {location}
      </p>
    );
  }

  const reasonText =
    outcome.reason === "condition"
      ? "different condition"
      : outcome.reason === "printing"
        ? "different printing"
        : "over your budget";

  return (
    <p
      className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
      data-testid="substitution-note"
    >
      <TriangleAlert className="size-3" aria-hidden />
      Substituted ({reasonText}): {price} · {location}
    </p>
  );
}

function LineResult({
  line,
  selectedPrintingId,
  onSelect,
  substitutionOutcome,
}: {
  line: DecklistImportLine;
  selectedPrintingId: string | undefined;
  onSelect: (printingId: string) => void;
  substitutionOutcome: SubstitutionOutcome<SubstitutionCandidate> | undefined;
}) {
  if (line.candidates.length === 0) {
    return (
      <li className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-medium">
            {line.quantity}× {line.name}
          </p>
          <p className="text-muted-foreground">No match found in the catalogue.</p>
        </div>
      </li>
    );
  }

  if (line.candidates.length === 1) {
    const candidate = line.candidates[0];
    return (
      <li className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium">
            {line.quantity}× {line.name}
          </p>
          <p className="text-muted-foreground">
            {candidate.setName} · #{candidate.collectorNumber}
          </p>
          <SubstitutionNote outcome={substitutionOutcome} />
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-testid="ambiguous-line">
      <p className="font-medium">
        {line.quantity}× {line.name}
      </p>
      <p className="text-xs text-muted-foreground">
        {line.candidates.length} printings match — choose which one you mean:
      </p>
      <div className="flex flex-col gap-1.5">
        {line.candidates.map((candidate) => (
          <label
            key={candidate.printingId}
            className="flex items-center gap-2 rounded-md border p-2 has-[:checked]:border-primary"
          >
            <input
              type="radio"
              name={`line-${line.raw}`}
              value={candidate.printingId}
              checked={selectedPrintingId === candidate.printingId}
              onChange={() => onSelect(candidate.printingId)}
            />
            <span>
              {candidate.setName} · #{candidate.collectorNumber}
            </span>
          </label>
        ))}
      </div>
      <SubstitutionNote outcome={substitutionOutcome} />
    </li>
  );
}

export function DecklistImport() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<DecklistImportResult | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});

  const [preferredConditionCode, setPreferredConditionCode] = useState("nm");
  const [maxBudgetInput, setMaxBudgetInput] = useState("");
  const [substitutionStatus, setSubstitutionStatus] = useState<Status>("idle");
  const [substitutions, setSubstitutions] = useState<
    Record<number, SubstitutionOutcome<SubstitutionCandidate>>
  >({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setSubstitutions({});

    try {
      const imported = await importDecklist(text);
      setResult(imported);
      setSelections(initialSelections(imported));
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  async function handleCheckPricing() {
    if (!result) return;

    const resolvedIndices = Object.keys(selections).map(Number);
    if (resolvedIndices.length === 0) return;

    setSubstitutionStatus("loading");

    const preferredConditionSortOrder =
      CONDITIONS.find((condition) => condition.code === preferredConditionCode)?.sortOrder ?? 1;
    const maxBudget = maxBudgetInput.trim() ? Number(maxBudgetInput) : null;

    try {
      const requestLines = resolvedIndices.map((index) => {
        const printingId = selections[index];
        const candidate = result.lines[index].candidates.find((c) => c.printingId === printingId);
        return { oracleCardId: candidate!.oracleCardId, preferredPrintingId: printingId };
      });

      const outcomes = await getSubstitutions(requestLines, {
        preferredConditionCode,
        preferredConditionSortOrder,
        maxBudget,
      });

      const byIndex: Record<number, SubstitutionOutcome<SubstitutionCandidate>> = {};
      resolvedIndices.forEach((index, i) => {
        byIndex[index] = outcomes[i];
      });
      setSubstitutions(byIndex);
      setSubstitutionStatus("done");
    } catch {
      setSubstitutionStatus("error");
    }
  }

  const resolvedCount = result
    ? result.lines.filter((_, index) => selections[index] !== undefined).length
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="decklist-text" className="text-sm font-medium">
          Paste your decklist
        </label>
        <textarea
          id="decklist-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          placeholder={"4 Lightning Bolt\n2 Counterspell (2X2)\n..."}
          className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm"
        />
        <Button
          type="submit"
          disabled={status === "loading" || !text.trim()}
          className="self-start"
        >
          {status === "loading" ? "Matching…" : "Match list"}
        </Button>
      </form>

      {status === "error" && (
        <p className="text-sm text-destructive" data-testid="decklist-import-status">
          Couldn&apos;t match this list. Please try again.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4" data-testid="decklist-import-status">
          <p className="text-sm text-muted-foreground">
            {resolvedCount} of {result.lines.length} lines resolved
            {result.skippedLines.length > 0 &&
              ` · ${result.skippedLines.length} line${result.skippedLines.length === 1 ? "" : "s"} skipped (comments/section headers)`}
          </p>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Preferred condition</span>
              <select
                value={preferredConditionCode}
                onChange={(event) => setPreferredConditionCode(event.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {CONDITIONS.map((condition) => (
                  <option key={condition.code} value={condition.code}>
                    {condition.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Max budget per card</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxBudgetInput}
                onChange={(event) => setMaxBudgetInput(event.target.value)}
                placeholder="No limit"
                className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resolvedCount === 0 || substitutionStatus === "loading"}
              onClick={handleCheckPricing}
            >
              {substitutionStatus === "loading" ? "Checking…" : "Check pricing & availability"}
            </Button>
          </div>

          {substitutionStatus === "error" && (
            <p className="text-sm text-destructive">
              Couldn&apos;t check pricing and availability. Please try again.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {result.lines.map((line, index) => (
              <LineResult
                key={`${line.raw}-${index}`}
                line={line}
                selectedPrintingId={selections[index]}
                onSelect={(printingId) =>
                  setSelections((current) => ({ ...current, [index]: printingId }))
                }
                substitutionOutcome={substitutions[index]}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
