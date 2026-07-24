#!/usr/bin/env node
// B-205: fail the build if a server-only secret leaks into the client bundle.
//
// AGENTS.md rule 3 says the Supabase service-role key and Stripe secret key
// must never reach browser code. Next.js only statically inlines
// NEXT_PUBLIC_*-prefixed env vars into client output, so a leak here means
// either a server-only env var got the NEXT_PUBLIC_ prefix by mistake, or a
// real secret value was hardcoded somewhere that ended up in a client-bundled
// module. Run after `next build` against apps/web/.next/static.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = join(import.meta.dirname, "..", ".next", "static");

// Env var *names* that must never appear as string literals in client JS —
// their presence means source code referencing them was bundled for the
// browser, regardless of whether a real value was inlined.
const FORBIDDEN_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY"];

// Value *shapes* that indicate an actual secret leaked, independent of how
// it was referenced.
const FORBIDDEN_VALUE_PATTERNS = [
  { name: "Stripe secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{10,}\b/ },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else if (entry.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

function main() {
  let files;
  try {
    files = walk(STATIC_DIR);
  } catch (err) {
    console.error(
      `check-client-bundle-secrets: could not read ${STATIC_DIR} — run "next build" first.`,
    );
    console.error(err.message);
    process.exit(1);
  }

  const violations = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");

    for (const name of FORBIDDEN_NAMES) {
      if (content.includes(name)) {
        violations.push(`${file}: contains forbidden env var name "${name}"`);
      }
    }

    for (const { name, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        violations.push(`${file}: contains a ${name} value (matched ${match[0].slice(0, 12)}…)`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("check-client-bundle-secrets: FAILED — secrets found in client bundle:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `check-client-bundle-secrets: OK — scanned ${files.length} client bundle file(s), no leaks found.`,
  );
}

main();
