"use client";

import { useState } from "react";
import { Check, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  importDecklist,
  type DecklistImportLine,
  type DecklistImportResult,
} from "@/features/deck-builder/actions/match-decklist";

type Status = "idle" | "loading" | "done" | "error";

function initialSelections(result: DecklistImportResult): Record<number, string> {
  const selections: Record<number, string> = {};
  result.lines.forEach((line, index) => {
    if (line.candidates.length === 1) {
      selections[index] = line.candidates[0].printingId;
    }
  });
  return selections;
}

function LineResult({
  line,
  selectedPrintingId,
  onSelect,
}: {
  line: DecklistImportLine;
  selectedPrintingId: string | undefined;
  onSelect: (printingId: string) => void;
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
    </li>
  );
}

export function DecklistImport() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<DecklistImportResult | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    try {
      const imported = await importDecklist(text);
      setResult(imported);
      setSelections(initialSelections(imported));
      setStatus("done");
    } catch {
      setStatus("error");
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
        <div className="flex flex-col gap-3" data-testid="decklist-import-status">
          <p className="text-sm text-muted-foreground">
            {resolvedCount} of {result.lines.length} lines resolved
            {result.skippedLines.length > 0 &&
              ` · ${result.skippedLines.length} line${result.skippedLines.length === 1 ? "" : "s"} skipped (comments/section headers)`}
          </p>

          <ul className="flex flex-col gap-2">
            {result.lines.map((line, index) => (
              <LineResult
                key={`${line.raw}-${index}`}
                line={line}
                selectedPrintingId={selections[index]}
                onSelect={(printingId) =>
                  setSelections((current) => ({ ...current, [index]: printingId }))
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
