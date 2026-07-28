"use client";

import { useState, useTransition } from "react";
import * as Sentry from "@sentry/nextjs";
import { Search, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/staff/status-badge";
import {
  searchCustomers,
  getCustomerDetail,
  type CustomerSummary,
  type CustomerDetail,
} from "@/features/staff/actions/fetch-customers";
import {
  getStoreCreditAccount,
  listStoreCreditLedger,
  type StoreCreditAccount,
  type StoreCreditLedgerEntry,
} from "@/features/staff/actions/manage-store-credit";
import { StoreCreditPanel } from "@/features/staff/components/store-credit-panel";

function formatMoney(amount: number, currency: string | null): string {
  if (!currency) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", { dateStyle: "medium" });
}

export function CustomerDirectory({
  initialCustomers,
  permissions,
}: {
  initialCustomers: CustomerSummary[];
  permissions: string[];
}) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [creditAccount, setCreditAccount] = useState<StoreCreditAccount | null>(null);
  const [creditLedger, setCreditLedger] = useState<StoreCreditLedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const canManageCredit = permissions.includes("customers.credit");

  async function loadCredit(customerId: string) {
    const [account, ledger] = await Promise.all([
      getStoreCreditAccount(customerId),
      listStoreCreditLedger(customerId),
    ]);
    setCreditAccount(account);
    setCreditLedger(ledger);
  }

  function onSearch() {
    setError(null);
    setDetail(null);
    startSearch(async () => {
      try {
        setCustomers(await searchCustomers(query));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        Sentry.captureException(err);
      }
    });
  }

  async function onOpen(customer: CustomerSummary) {
    setLoadingId(customer.id);
    setError(null);

    try {
      const [customerDetail] = await Promise.all([
        getCustomerDetail(customer.id),
        loadCredit(customer.id),
      ]);
      setDetail(customerDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the customer");
      Sentry.captureException(err);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by display name"
            aria-label="Search customers by display name"
            className="h-10 pl-8"
          />
        </div>
        <Button type="submit" disabled={isSearching}>
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {detail ? (
        <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <User className="size-4 text-primary" aria-hidden />
                {detail.displayName ?? "Unnamed customer"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Customer since {formatDate(detail.createdAt)}
                {detail.phone ? ` · ${detail.phone}` : ""}
              </p>
            </div>
            <Button
              variant="outline"
              className="text-xs"
              onClick={() => {
                setDetail(null);
                setCreditAccount(null);
                setCreditLedger([]);
              }}
            >
              Close
            </Button>
          </div>

          {creditAccount ? (
            <StoreCreditPanel
              customerId={detail.id}
              canManage={canManageCredit}
              account={creditAccount}
              ledger={creditLedger}
              onChanged={() => loadCredit(detail.id)}
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Orders with your stores</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{detail.orderCount}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total spend</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(detail.totalSpend, detail.currency)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Last order</p>
              <p className="mt-1 text-xl font-semibold">{formatDate(detail.lastOrderAt)}</p>
            </div>
          </div>

          {detail.addresses.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Addresses</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {detail.addresses.map((address) => (
                  <li key={address.id} className="rounded-lg border p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{address.label ?? "Address"}</span>
                      {address.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                      <br />
                      {[address.city, address.region, address.postalCode]
                        .filter(Boolean)
                        .join(" ")}{" "}
                      {address.country}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold">Order history</h3>
            {detail.orders.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No orders at your stores. Orders placed at stores outside your scope are not shown.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-3 py-2 text-left font-semibold">Order #</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-left font-semibold">Type</th>
                      <th className="px-3 py-2 text-left font-semibold">Store</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="px-3 py-2 text-left font-semibold">Placed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((order) => (
                      <tr key={order.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs font-semibold">
                          {order.orderNumber}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {order.fulfilmentType === "click_and_collect"
                            ? "Click & Collect"
                            : "Shipping"}
                        </td>
                        <td className="px-3 py-2 text-xs">{order.nodeName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(order.totalAmount, order.currency)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDate(order.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query ? `No customers matching “${query}”.` : "No customer accounts yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-semibold">Customer</th>
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-right font-semibold">Orders</th>
                <th className="px-4 py-3 text-right font-semibold">Spend</th>
                <th className="px-4 py-3 text-left font-semibold">Last order</th>
                <th className="px-4 py-3 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b last:border-b-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{customer.displayName ?? "Unnamed customer"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Joined {formatDate(customer.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{customer.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{customer.orderCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(customer.totalSpend, customer.currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(customer.lastOrderAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      className="text-xs"
                      disabled={loadingId === customer.id}
                      onClick={() => onOpen(customer)}
                    >
                      {loadingId === customer.id ? "Loading…" : "View"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
