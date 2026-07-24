import { getProfile, listAddresses } from "@/features/customer/actions/manage-profile";
import { listActiveStores } from "@/features/customer/queries/list-active-stores";
import { ProfileEditor } from "@/features/customer/components/profile-editor";
import { AddressManager } from "@/features/customer/components/address-manager";

// Requires an authenticated user's session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  let unauthenticated = false;
  let error: string | null = null;
  let profile: Awaited<ReturnType<typeof getProfile>> | null = null;
  let addresses: Awaited<ReturnType<typeof listAddresses>> = [];
  let stores: Awaited<ReturnType<typeof listActiveStores>> = [];

  try {
    [profile, addresses, stores] = await Promise.all([
      getProfile(),
      listAddresses(),
      listActiveStores(),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message === "Not authenticated") {
      unauthenticated = true;
    } else {
      error = err instanceof Error ? err.message : "Failed to load your account";
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, preferred store, and saved addresses.
        </p>
      </div>

      {unauthenticated ? (
        <p className="text-sm text-muted-foreground" data-testid="account-status">
          Sign in to your account to view and edit your profile.
        </p>
      ) : error ? (
        <p className="text-sm text-destructive" data-testid="account-status">
          {error}
        </p>
      ) : (
        profile && (
          <>
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Profile</h2>
              <ProfileEditor profile={profile} stores={stores} />
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Addresses</h2>
              <AddressManager initialAddresses={addresses} />
            </section>
          </>
        )
      )}
    </div>
  );
}
