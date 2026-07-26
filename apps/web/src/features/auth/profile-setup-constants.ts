/**
 * Shared between the profile setup form and the Server Action that validates
 * it, so the input's maxLength and the server-side check cannot drift apart.
 *
 * Lives outside the action module because a `"use server"` file may only
 * export async functions — exporting a plain constant from one strips every
 * export from the module, which fails at build time rather than typecheck.
 */
export const DISPLAY_NAME_MAX_LENGTH = 60;
