import { describe, expect, it } from "vitest";

import { DEFAULT_SAFE_REDIRECT, safeRedirectPath } from "./safe-redirect";

const NUL = String.fromCharCode(0);
const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe("safeRedirectPath", () => {
  it("keeps an in-application path", () => {
    expect(safeRedirectPath("/account/orders")).toBe("/account/orders");
  });

  it("keeps a path with a query string and fragment", () => {
    expect(safeRedirectPath("/search?q=bolt#results")).toBe("/search?q=bolt#results");
  });

  it("falls back when there is no candidate", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(safeRedirectPath("")).toBe(DEFAULT_SAFE_REDIRECT);
  });

  it("uses the caller's fallback when one is given", () => {
    expect(safeRedirectPath(null, "/staff/dashboard")).toBe("/staff/dashboard");
  });

  // Each of these is a way to leave the origin. A signed-in user is at their
  // most trusting immediately after authenticating, which is exactly when an
  // open redirect pays off for an attacker.
  it.each([
    ["absolute https URL", "https://evil.example/steal"],
    ["absolute http URL", "http://evil.example"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash-smuggled URL", "/\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>"],
    ["bare relative path", "account"],
  ])("rejects %s", (_label, candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_SAFE_REDIRECT);
  });

  it("rejects paths containing control characters", () => {
    // A newline can terminate a header or slip past a naive prefix check.
    expect(safeRedirectPath(`/account${NEWLINE}Set-Cookie: a=b`)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(safeRedirectPath(`/account${NUL}`)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(safeRedirectPath(`/account${TAB}tab`)).toBe(DEFAULT_SAFE_REDIRECT);
  });

  it("returns an empty fallback so callers can detect 'no safe path'", () => {
    // destinationFor() relies on this to decide between an explicit
    // destination and the role-based default.
    expect(safeRedirectPath("https://evil.example", "")).toBe("");
  });
});
