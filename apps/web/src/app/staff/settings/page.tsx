import { ShieldCheck } from "lucide-react";

import {
  fetchStaffSettings,
  type StaffSettings,
} from "@/features/staff/actions/fetch-staff-settings";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";

// Requires an authenticated staff session at request time — cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

const SCOPE_LABELS: Record<string, string> = {
  store: "Single store",
  selected_stores: "Selected stores",
  region: "Regional",
  all_stores: "All stores",
  organisation: "Organisation-wide",
};

function humaniseRole(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

export default async function StaffSettingsPage() {
  let settings: StaffSettings | null = null;
  let error: string | null = null;

  try {
    settings = await fetchStaffSettings();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load settings";
  }

  if (error || !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "You do not have an active staff membership."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your access, your team's roles, and what each role is permitted to do."
      />

      <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Your access
        </h2>

        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd className="mt-1 font-medium">{humaniseRole(settings.roleCode)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Scope</dt>
            <dd className="mt-1 font-medium">
              {SCOPE_LABELS[settings.scopeType] ?? settings.scopeType}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Stores</dt>
            <dd className="mt-1 font-medium">
              {settings.nodeNames.length > 0 ? settings.nodeNames.join(", ") : "None"}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">Permissions</p>
          {settings.permissions.length === 0 ? (
            <p className="mt-2 text-sm text-destructive">
              Your role has no permissions granted. Staff screens will refuse actions until an
              administrator grants them.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {settings.permissions.map((permission) => (
                <li key={permission}>
                  <Badge variant="secondary">
                    <span className="font-mono">{permission}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Team</h2>
        {!settings.canSeeTeam ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Only organisation-wide and all-stores roles can see the full staff list.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-semibold">Member</th>
                  <th className="px-4 py-3 text-left font-semibold">Role</th>
                  <th className="px-4 py-3 text-left font-semibold">Scope</th>
                  <th className="px-4 py-3 text-left font-semibold">Store / region</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {settings.team.map((member) => (
                  <tr key={member.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {member.displayName ?? (
                          <span className="font-mono text-xs">
                            {member.userId.slice(0, 8).toUpperCase()}
                          </span>
                        )}
                      </span>
                      {member.isSelf ? (
                        <Badge variant="outline" className="ml-2">
                          You
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{humaniseRole(member.roleCode)}</td>
                    <td className="px-4 py-3 text-xs">
                      {SCOPE_LABELS[member.scopeType] ?? member.scopeType}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {member.nodeName ?? member.region ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={member.active ? "success" : "outline"}>
                        {member.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Role permissions</h2>
        <p className="text-sm text-muted-foreground">
          What each role is allowed to do. Staff actions check these at the database level, so a
          missing permission blocks the action regardless of what the interface offers.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {settings.roleMatrix.map((role) => (
            <article key={role.roleCode} className="rounded-lg border bg-card p-4">
              <h3 className="font-medium">{role.description}</h3>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{role.roleCode}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {role.permissions.map((permission) => (
                  <li key={permission}>
                    <Badge variant="outline">
                      <span className="font-mono">{permission}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
