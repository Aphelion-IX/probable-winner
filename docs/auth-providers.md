# Authentication: Google and Apple sign-in

Sign-in is Supabase Auth with two OAuth providers. Supabase handles
*authentication* (proving who someone is). This database handles
*authorization* (what they may do). The two are deliberately separate:
**signing in with Google or Apple grants no internal access on its own.**

## How access is decided

| Question | Answered by |
| --- | --- |
| Who is this? | Supabase Auth session, re-validated with `auth.getUser()` |
| Do they have a profile? | `public.profiles` row |
| Are they staff? | `public.staff_memberships` row (active) |
| What may staff do? | `role_permissions` for that membership's `role_code` |
| Is the data actually protected? | RLS policies on every table |

Internal access comes from a `staff_memberships` row and nothing else. It is
never inferred from the OAuth provider, the email domain, `user_metadata`,
frontend state, a URL parameter, or local storage. `staff_memberships`,
`role_permissions` and `permissions` are RLS-enabled and have **only** SELECT
policies — no INSERT, UPDATE or DELETE policy exists, so a signed-in user
cannot grant themselves a role through the Data API. Role assignment is a
protected administrative action, done through migrations or the staff settings
screen by someone who already holds the rights.

Route guards (`requireUser`, `requireStaff`) exist for user experience — they
stop a protected page from rendering and redirect instead. They are not the
protection. RLS is.

## Application flow

1. `/login` renders **Continue with Google** and **Continue with Apple**.
2. `signInWithOAuth(provider, returnTo)` calls
   `supabase.auth.signInWithOAuth()` with
   `redirectTo = ${window.location.origin}/auth/callback`.
3. The provider returns the browser to `/auth/callback?code=…`.
4. The callback exchanges the code for a session, then calls `getUser()` to
   re-validate. A `code` in the URL is never treated as proof of anything.
5. It ensures a `profiles` row exists, resolves staff membership, and
   redirects:
   - no display name yet → `/account/setup`
   - a validated `next` → that path
   - otherwise staff → `/staff/dashboard`, customers → `/account`

Return paths are validated by `safeRedirectPath()` on both legs of the round
trip. Only in-application absolute paths survive; absolute URLs,
protocol-relative `//host`, backslash-smuggled `/\host`, non-`/` paths and
anything containing control characters fall back to a safe default.

## Manual configuration

None of the following belongs in this repository. Provider secrets live only
in the Supabase dashboard; the browser only ever sees
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### The callback URL

Both providers redirect to Supabase, not to this application:

```
https://lbsxsptpyhypuheuosye.supabase.co/auth/v1/callback
```

That is the value taken from this project (`probable-winner`,
`ap-southeast-1`). Confirm it in **Supabase → Authentication → Providers**
before pasting it into a provider console — it is shown there per project.
`/auth/callback` in this app is a *separate* application route that the user
lands on afterwards.

### Google

1. Google Cloud Console → **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID**, type **Web application**.
3. **Authorised JavaScript origins** — the sites users sign in from:
   - `http://localhost:3000`
   - the production origin
   - any preview origin that must support sign-in
4. **Authorised redirect URIs** — the Supabase callback URL above.
5. Copy the **Client ID** and **Client secret**.
6. Supabase → **Authentication → Providers → Google**: enable, paste both,
   save.

### Apple

Apple is more involved: sign-in needs a Services ID, a key, and a client
secret that is a signed JWT rather than a static string.

1. Apple Developer → **Certificates, Identifiers & Profiles → Identifiers**.
2. Create an **App ID** if you do not have one, with **Sign In with Apple**
   enabled.
3. Create a **Services ID** (this becomes the OAuth client ID, e.g.
   `com.example.probablewinner.web`). Enable **Sign In with Apple** on it.
4. Configure the Services ID:
   - **Domains and Subdomains**: your production domain (Apple rejects
     `localhost`, so local sign-in goes through the Supabase callback domain)
   - **Return URLs**: the Supabase callback URL above
5. **Keys → new key**, enable **Sign In with Apple**, download the `.p8`.
   Apple lets you download it **once**.
6. Generate the client secret JWT from: the `.p8` key, the **Key ID**, your
   **Team ID**, and the **Services ID**.
7. Supabase → **Authentication → Providers → Apple**: enable, set the
   Services ID as the client ID and the generated JWT as the secret.

**Apple secret renewal — this expires.** The client secret is a JWT with a
maximum lifetime of **6 months**. When it expires, Apple sign-in stops working
with no warning and no code change to blame. Put a calendar reminder ahead of
the expiry, regenerate the JWT from the same `.p8`, and update it in Supabase.
The `.p8` key itself does not expire; only the JWT does.

### Supabase URL configuration

**Authentication → URL Configuration**:

- **Site URL** — the canonical production origin. Used as the default
  redirect target and in email links.
- **Redirect URLs** — an allow-list. Every origin that may complete a sign-in
  must appear, or Supabase rejects the redirect:
  - `http://localhost:3000/auth/callback`
  - `https://<production-domain>/auth/callback`
  - preview deployments: Vercel generates a new origin per deployment, so
    either add a wildcard pattern (e.g.
    `https://<project>-*.vercel.app/auth/callback`) or accept that sign-in
    only works on stable origins. Do not set Site URL to a preview origin —
    it is global, and doing so redirects production sign-ins to a preview.

## Apple specifics worth knowing

- **Names arrive once, if at all.** Apple returns the user's name only on the
  very first authorisation, and the user can decline. The application never
  depends on it: a missing name routes the user to `/account/setup`.
- **Hide My Email.** Users may sign in with a private relay address
  (`…@privaterelay.appleid.com`). It is a real, deliverable address, but it
  will not match their Google address, so Supabase treats it as a separate
  identity — and, if they used it first, a separate account.

## Account linking

Supabase links identities itself when two providers return the **same verified
email**. When Apple returns a relay address it does not match, so no link is
made.

The application does not merge accounts. Merging on an unverified match is an
account-takeover primitive, and relay addresses mean "same person" is exactly
what cannot be established from the email. Connected sign-in methods are shown
read-only under **Account → Sign-in methods**.

## Local development

```
NEXT_PUBLIC_SUPABASE_URL=https://lbsxsptpyhypuheuosye.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
```

Both are public by design — RLS is what protects the data. The service-role
key must never appear in `apps/web` (AGENTS.md rule 3); `pnpm --filter web
check:secrets` guards the client bundle.

Google works against `http://localhost:3000` once that origin is registered.
Apple does not accept `localhost` as a domain, so testing Apple sign-in
locally requires a tunnel with a real domain, or a deployed preview.
