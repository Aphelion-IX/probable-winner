"use server";

import { getSubstitutionCandidatesByOracleCard } from "@/features/deck-builder/queries/get-substitution-candidates";
import {
  resolveSubstitution,
  type BudgetPreferences,
  type SubstitutionOutcome,
} from "@/features/deck-builder/lib/resolve-substitution";
import type { SubstitutionCandidate } from "@/features/deck-builder/queries/get-substitution-candidates";

export type SubstitutionRequestLine = {
  oracleCardId: string;
  preferredPrintingId: string;
};

// Returned in the same order as the input lines (not keyed by oracle card
// id) so a line-index zip on the caller's side works even if two lines
// happen to reference the same oracle card.
export async function getSubstitutions(
  lines: SubstitutionRequestLine[],
  preferences: BudgetPreferences,
): Promise<SubstitutionOutcome<SubstitutionCandidate>[]> {
  const candidatesByOracleCard = await getSubstitutionCandidatesByOracleCard(
    lines.map((line) => line.oracleCardId),
  );

  return lines.map((line) =>
    resolveSubstitution(
      candidatesByOracleCard.get(line.oracleCardId) ?? [],
      line.preferredPrintingId,
      preferences,
    ),
  );
}
