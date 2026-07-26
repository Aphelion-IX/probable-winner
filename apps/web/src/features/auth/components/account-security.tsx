import { Button } from "@/components/ui/button";
import { createServerSupabaseClient } from "@/server/supabase";
import { signOut } from "../actions/sign-out";

const PROVIDER_LABELS: Record<string, string> = {
  email: "Email",
};

// Falls through to the raw provider name rather than hiding an unrecognised
// identity: an account showing a sign-in method nobody expected is exactly
// the thing a user needs to be able to see.
function formatProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Shows which sign-in methods are connected to this account, and offers sign
 * out.
 *
 * Identities come from Supabase (`getUserIdentities`), which is the only
 * authority on what is actually linked. With email sign-in this is normally a
 * single `email` identity, but it is read rather than assumed — an account
 * that picked up another identity should show it here rather than silently.
 *
 * Read-only by design. Linking and unlinking are deliberately absent: they
 * change how an account can be accessed, which deserves its own verified flow
 * rather than a button next to a list.
 */
export async function AccountSecurity() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUserIdentities();

  const identities = data?.identities ?? [];

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 className="text-lg font-medium">Sign-in methods</h2>
        <p className="mt-1 text-sm text-muted-foreground">The accounts you can use to sign in.</p>
      </div>

      {identities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No linked sign-in methods found.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="connected-identities">
          {identities.map((identity) => (
            <li
              key={identity.identity_id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{formatProvider(identity.provider)}</span>
              {identity.identity_data?.email ? (
                <span className="text-muted-foreground">
                  {String(identity.identity_data.email)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form action={signOut}>
        <Button type="submit" variant="outline" data-testid="sign-out">
          Sign out
        </Button>
      </form>
    </section>
  );
}
