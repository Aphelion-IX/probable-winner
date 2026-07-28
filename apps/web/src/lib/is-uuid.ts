// Route params (e.g. /cards/[name]/[id]) are arbitrary strings from the
// URL, not typed values -- a malformed or missing id (a stale link, a bot
// guessing paths, a literal "undefined" from a broken caller) reaching a
// uuid-typed column as a Postgrest .eq() filter throws "invalid input
// syntax for type uuid", an unhandled 500 rather than a clean 404. Callers
// should check this before querying and treat a non-match as "not found".
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
