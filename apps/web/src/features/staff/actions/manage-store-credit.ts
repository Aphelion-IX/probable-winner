"use server";

// Customer store credit (blueprint §8.9, migration
// 20260728000000_store_credit_accounts_and_ledger.sql). Reads go through
// plain RLS-scoped selects; every write goes through adjust_store_credit(),
// which locks the account row, validates, writes the ledger row, and
// updates the balance atomically -- never arithmetic against
// store_credit_accounts here (AGENTS.md rules 2 and 12, same reasoning as
// inventory).
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export const CREDIT_ENTRY_TYPES = [
  { value: "trade_in", label: "Trade-in" },
  { value: "goodwill", label: "Goodwill" },
  { value: "refund", label: "Refund as credit" },
  { value: "correction", label: "Correction" },
] as const;

export const DEBIT_ENTRY_TYPES = [
  { value: "redemption", label: "Redemption" },
  { value: "correction", label: "Correction" },
] as const;

export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number]["value"];
export type DebitEntryType = (typeof DEBIT_ENTRY_TYPES)[number]["value"];

export interface StoreCreditAccount {
  balance: number;
  currency: string;
}

export interface StoreCreditLedgerEntry {
  id: string;
  entryType: string;
  amountDelta: number;
  reason: string;
  createdAt: string;
}

export interface StoreCreditActionResult {
  success: boolean;
  error?: string;
}

/** A customer with no store_credit_accounts row yet simply has a $0 balance. */
export async function getStoreCreditAccount(customerId: string): Promise<StoreCreditAccount> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { balance: 0, currency: "AUD" };
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("store_credit_accounts")
    .select("balance, currency")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    logger.error("Get store credit account failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load store credit");
  }

  return { balance: data ? Number(data.balance) : 0, currency: data?.currency ?? "AUD" };
}

const MAX_LEDGER_ROWS = 50;

export async function listStoreCreditLedger(customerId: string): Promise<StoreCreditLedgerEntry[]> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data: account, error: accountError } = await supabase
    .from("store_credit_accounts")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (accountError) {
    logger.error("Load store credit account for ledger failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(accountError),
    });
    throw new Error("Failed to load store credit history");
  }

  if (!account) {
    return [];
  }

  const { data, error } = await supabase
    .from("store_credit_ledger")
    .select("id, entry_type, amount_delta, reason, created_at")
    .eq("store_credit_account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(MAX_LEDGER_ROWS);

  if (error) {
    logger.error("List store credit ledger failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load store credit history");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    entryType: row.entry_type,
    amountDelta: Number(row.amount_delta),
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

/**
 * Applies or removes store credit. A positive amount adds credit, a
 * negative amount removes it; adjust_store_credit() is what writes the
 * ledger row and recomputes the balance, and rejects a removal that would
 * take the balance negative.
 */
export async function adjustCustomerCredit(input: {
  customerId: string;
  amountDelta: number;
  entryType: string;
  reason: string;
}): Promise<StoreCreditActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("customers.credit")) {
    return { success: false, error: "You do not have the customers.credit permission" };
  }

  if (input.amountDelta === 0) {
    return { success: false, error: "Enter a non-zero amount" };
  }

  if (!input.reason.trim()) {
    return { success: false, error: "A reason is required" };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("adjust_store_credit", {
    p_customer_id: input.customerId,
    p_amount_delta: input.amountDelta,
    p_entry_type: input.entryType,
    p_reason: input.reason.trim(),
  });

  if (error) {
    logger.error("Adjust store credit failed", {
      requestId: await getRequestId(),
      customerId: input.customerId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}
