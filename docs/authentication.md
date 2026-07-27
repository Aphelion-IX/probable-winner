# Authentication: passwordless email sign-in

Sign-in is Supabase Auth using a **one-time email code** — no password, and no
external identity provider. Supabase handles *authentication* (proving who
someone is). This database handles *authorization* (what they may do).

Google and Apple OAuth were implemented and then removed in favour of this.
Nothing about the authorization model changed with that swap: **how someone
proves their identity has never had any bearing on what they may do.**

## How access is decided

| Question | Answered by |
| --- | --- |
| Who is this? | Supabase Auth session, re-validated with `auth.getUser()` |
| Do they have a profile? | `public.profiles` row |
| Are they staff? | `public.staff_memberships` row (active) |
| What may staff do? | `role_permissions` for that membership's `role_code` |
| Is the data actually protected? | RLS policies on every table |

Internal access comes from a `staff_memberships` row and nothing else. It is
never inferred from the email address, the email *domain*, `user_metadata`,
frontend state, a URL parameter, or local storage. `staff_memberships`,
`role_permissions` and `permissions` are RLS-enabled and have **only** SELECT
policies — no INSERT, UPDATE or DELETE policy exists — so a signed-in user
cannot grant themselves a role through the Data API. Role assignment is a
protected administrative action.

Route guards (`requireUser`, `requireStaff`) exist for user experience — they
stop a protected page from rendering and redirect instead. They are not the
protection. RLS is.

## The flow

1. `/login` asks for an email address.
2. `sendEmailOtp(email)` calls `supabase.auth.signInWithOtp({ email })`.
   Supabase emails a numeric code — its exact length is set by
   **Authentication → Providers → Email → Email OTP Length** in the
   dashboard, not by this app, so the code input accepts a range
   (`OTP_MIN_LENGTH`–`OTP_MAX_LENGTH` in `sign-in-with-email.ts`) rather than
   a single hardcoded length. A first-time address gets an account created
   automatically — there is no separate registration step.
3. The user types the code; `verifyEmailOtp(email, token)` calls
   `verifyOtp({ email, token, type: 'email' })`, which writes the auth
   cookies.
4. The browser navigates to `/auth/complete`, which re-validates with
   `getUser()`, ensures a `profiles` row exists, and routes:
   - no display name yet → `/account/setup`
   - a validated `next` → that path
   - otherwise staff → `/staff/dashboard`, customers → `/account`

Arriving at `/auth/complete` is never treated as proof of anything — anyone
can type that URL. Only `getUser()` decides, and it re-validates the token
against the auth server rather than trusting the cookie.

Return paths are validated by `safeRedirectPath()` wherever they are accepted.
Only in-application absolute paths survive; absolute URLs, protocol-relative
`//host`, backslash-smuggled `/\host`, non-rooted paths and anything
containing control characters fall back to a safe default. Without this,
`/login?next=https://evil.example` is an open redirect pointed at users at
their most trusting moment.

## Required manual configuration

Only one thing needs setting up, and **sign-in does not work correctly until
it is done**.

### Send a code, not a magic link

Email OTP and Magic Link share a single template in Supabase. The default
template contains `{{ .ConfirmationURL }}`, which sends a *link*. This
application expects a *code*.

In **Authentication → Email Templates → Magic Link**, use a template built
around `{{ .Token }}`:

```html
<h2>Your sign-in code</h2>
<p>Enter this code to sign in:</p>
<p style="font-size: 24px; letter-spacing: 4px;"><strong>{{ .Token }}</strong></p>
<p>The code expires shortly. If you didn't request it, you can ignore this email.</p>
```

If the template is left as the default, users receive a link instead of a
code, and the code field on `/login` will have nothing to accept. Worse, the
default link would not work anyway: this app uses `@supabase/ssr`, which is a
**PKCE** flow, and a plain `{{ .ConfirmationURL }}` link is not valid under
PKCE — that needs a `{{ .TokenHash }}` link and a separate confirm route. The
numeric code avoids the whole problem, which is the main reason to prefer it
here.

### URL configuration

**Authentication → URL Configuration**:

- **Site URL** — the canonical production origin. Used in email links.
- **Redirect URLs** — less critical for code-based sign-in than for OAuth,
  since nothing redirects back from an external provider, but keep production
  and `http://localhost:3000` listed so email links resolve correctly.

Do not set Site URL to a preview deployment — it is global, and doing so
sends production email links to a preview.

### Email delivery — check before launch

Supabase's built-in email service is intended for development and is heavily
rate limited. Sign-in emails are not marketing mail; if they throttle, nobody
can log in. **Configure custom SMTP** (Authentication → Emails → SMTP
Settings) before real traffic, and confirm the current limit for your plan.

There is also a per-address request limit: a user can only request a code once
per interval. The app surfaces this as "Too many attempts. Please wait a
minute and try again."

### OTP expiry

**Authentication → Providers → Email → Email OTP Expiration.** Supabase caps
this at 86,400 seconds (one day) precisely because a longer window gives an
attacker more time to brute force a numeric code. Shorter is better; the
default is fine.

## Disabling the OAuth providers

Google was enabled on this project while OAuth was being built. With the
provider code removed, it should be switched off in **Authentication →
Providers → Google** so there is no enabled sign-in path the application does
not implement. Apple was never enabled.

Verify what is actually on:

```bash
curl -s "https://lbsxsptpyhypuheuosye.supabase.co/auth/v1/settings" \
  -H "apikey: <publishable key>" | jq .external
```

`email` should be `true`; `google` and `apple` should both be `false`.

## Guest checkout is a separate thing

Passwordless still creates an account: there is a real `auth.users` row, and
the `handle_new_customer()` trigger creates a `profiles` row alongside it. It
removes the password, not the account.

Buying without any account is a different mechanism that already exists:
`carts.guest_token` and `orders.guest_token`, checked server-side against the
httpOnly `cart_session_id` cookie. A guest is anonymous by definition, so
`auth.uid()` cannot identify them and no RLS policy could express "the holder
of this cookie" — which is why that path is checked in application code
against the cookie rather than by a policy.

## Local development

```
NEXT_PUBLIC_SUPABASE_URL=https://lbsxsptpyhypuheuosye.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
```

Both are public by design — RLS is what protects the data. The service-role
key must never appear in `apps/web` (AGENTS.md rule 3); `pnpm --filter web
check:secrets` guards the client bundle.

Email sign-in works against `http://localhost:3000` with no further setup,
which is the other practical advantage over OAuth: there is no provider
console, no redirect-URI registration, and no client secret to rotate.
