import { searchCustomers, type CustomerSummary } from "@/features/staff/actions/fetch-customers";
import { CustomerDirectory } from "@/features/staff/components/customer-directory";
import { PageHeader } from "@/components/staff/page-header";
import { getStaffContext } from "@/server/staff-context";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

export default async function StaffCustomersPage() {
  let customers: CustomerSummary[] = [];
  let error: string | null = null;

  try {
    customers = await searchCustomers("");
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load customers";
  }

  const staffContext = await getStaffContext();
  const permissions = staffContext?.permissions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Look up a customer to see their profile, saved addresses, and orders placed with your stores."
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <CustomerDirectory initialCustomers={customers} permissions={permissions} />
      )}
    </div>
  );
}
