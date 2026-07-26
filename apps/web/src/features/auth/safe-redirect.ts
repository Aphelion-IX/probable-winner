/**
 * Validates a post-login return path.
 *
 * Return paths arrive as untrusted input — they travel through a query string
 * that anyone can craft and put in a link. Without validation
 * this is a textbook open redirect: `/login?next=https://evil.example` would
 * hand a freshly-authenticated user straight to an attacker's page, which is
 * exactly the moment they are most likely to trust what they see.
 *
 * Only same-application absolute paths are allowed. Anything else falls back
 * to `fallback` rather than throwing, because a bad `next` should degrade to
 * "signed in, sent somewhere sensible" rather than breaking the login.
 *
 * Rejected, and why:
 *   - `https://evil.example`   absolute URL to another origin
 *   - `//evil.example`         protocol-relative; browsers treat it as absolute
 *   - `/\evil.example`         backslash; some browsers normalise `\` to `/`
 *   - `javascript:alert(1)`    scheme-relative payload
 *   - anything not starting with `/`
 *   - control characters, which can be used to smuggle past naive checks
 */
export const DEFAULT_SAFE_REDIRECT = "/account";

// Control characters (including newlines, tabs and NUL) never belong in a
// path and are a common way to sneak past prefix checks. Written as an
// explicit code-point scan rather than a regex character range so the source
// stays free of literal control bytes.
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SAFE_REDIRECT,
): string {
  if (!candidate) {
    return fallback;
  }

  if (hasControlCharacters(candidate)) {
    return fallback;
  }

  // Must be a rooted path. This alone rejects `https://…`, `javascript:…`
  // and bare relative paths.
  if (!candidate.startsWith("/")) {
    return fallback;
  }

  // `//host` is protocol-relative and `/\host` is normalised to `//host` by
  // some browsers — both leave the origin.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return fallback;
  }

  return candidate;
}
