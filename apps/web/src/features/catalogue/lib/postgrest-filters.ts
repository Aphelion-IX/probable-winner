// Sanitizes a user-provided string for safe embedding inside a PostgREST
// filter expression (.or()/.filter()): strips characters that would break
// the filter's own syntax (commas, parens) and escapes SQL LIKE wildcards
// so they're matched literally rather than as patterns.
export function sanitizeForIlike(term: string): string {
  const withoutFilterSyntax = term.replace(/[,()]/g, "").trim();
  return withoutFilterSyntax.replace(/[%_\\]/g, (match) => `\\${match}`);
}
