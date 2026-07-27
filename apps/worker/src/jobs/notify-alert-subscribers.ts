import type { Sql } from "postgres";

import type { EmailProvider } from "../integrations/email/types.js";

// restock_alerts/price_alerts (migration 20260724130000) speak a slightly
// different vocabulary than sellable_skus' finish/condition reference
// tables -- 'normal' instead of 'nonfoil', uppercase condition codes.
// Mirrors apps/web/src/features/catalogue/components/restock-alert-button.tsx's
// toRestockAlertFinish/toRestockAlertCondition at the other end of this
// boundary.
function toAlertFinish(finishCode: string): string {
  return finishCode === "nonfoil" ? "normal" : finishCode;
}

function toAlertCondition(conditionCode: string): string {
  return conditionCode.toUpperCase();
}

type SkuAlertContext = {
  cardPrintingId: string;
  finish: string;
  condition: string;
  cardName: string;
  setName: string;
};

type SkuAlertContextRow = {
  card_printing_id: string;
  finish_code: string;
  condition_code: string;
  card_name: string;
  set_name: string;
};

async function resolveSkuAlertContext(
  sql: Sql,
  sellableSkuId: string,
): Promise<SkuAlertContext | null> {
  const [row] = await sql<SkuAlertContextRow[]>`
    select
      ss.card_printing_id,
      f.code as finish_code,
      c.code as condition_code,
      oc.name as card_name,
      s.name as set_name
    from sellable_skus ss
    join finishes f on f.id = ss.finish_id
    join conditions c on c.id = ss.condition_id
    join card_printings cp on cp.id = ss.card_printing_id
    join oracle_cards oc on oc.id = cp.oracle_card_id
    join sets s on s.id = cp.set_id
    where ss.id = ${sellableSkuId}
  `;

  if (!row) {
    return null;
  }

  return {
    cardPrintingId: row.card_printing_id,
    finish: toAlertFinish(row.finish_code),
    condition: toAlertCondition(row.condition_code),
    cardName: row.card_name,
    setName: row.set_name,
  };
}

async function getCustomerEmail(sql: Sql, customerId: string): Promise<string | null> {
  const [row] = await sql<{ email: string | null }[]>`
    select email from auth.users where id = ${customerId}
  `;
  return row?.email ?? null;
}

// Restock check (B-192): triggered by the restock_alerts queue message
// emit_integration_event() sends alongside every inventory_balance_changed
// event. Re-reads current availability rather than trusting the event
// payload, same "outbox payload is minimal, consumer re-reads state"
// principle as the search_index consumer.
export async function processRestockAlertCheck(
  sql: Sql,
  emailProvider: EmailProvider,
  sellableSkuId: string,
): Promise<number> {
  const [{ total_available }] = await sql<{ total_available: string }[]>`
    select coalesce(sum(quantity_available_online), 0) as total_available
    from inventory_balances
    where sellable_sku_id = ${sellableSkuId}
  `;

  if (Number(total_available) <= 0) {
    return 0;
  }

  const context = await resolveSkuAlertContext(sql, sellableSkuId);
  if (!context) {
    return 0;
  }

  const matches = await sql<{ id: string; customer_id: string }[]>`
    select id, customer_id
    from restock_alerts
    where card_printing_id = ${context.cardPrintingId}
      and finish = ${context.finish}
      and condition = ${context.condition}
      and status = 'active'
  `;

  let notified = 0;
  for (const match of matches) {
    const email = await getCustomerEmail(sql, match.customer_id);
    if (!email) {
      continue;
    }

    const description = `${context.cardName} (${context.setName}, ${context.finish}, ${context.condition})`;
    await emailProvider.sendEmail({
      to: email,
      subject: `Back in stock: ${context.cardName}`,
      html: `<p>${description} is back in stock.</p>`,
      text: `${description} is back in stock.`,
    });

    await sql`
      update restock_alerts
      set status = 'triggered', triggered_at = now(), updated_at = now()
      where id = ${match.id}
    `;
    notified += 1;
  }

  return notified;
}

// Price-drop check (B-192): triggered by publish_suggested_price()'s
// restock_alerts enqueue. A match requires the alert's threshold currency
// to match the published currency -- no cross-currency comparison.
export async function processPriceAlertCheck(
  sql: Sql,
  emailProvider: EmailProvider,
  sellableSkuId: string,
  finalAmount: number,
  currency: string,
): Promise<number> {
  const context = await resolveSkuAlertContext(sql, sellableSkuId);
  if (!context) {
    return 0;
  }

  const matches = await sql<{ id: string; customer_id: string; alert_price: number }[]>`
    select id, customer_id, alert_price
    from price_alerts
    where card_printing_id = ${context.cardPrintingId}
      and finish = ${context.finish}
      and currency = ${currency}
      and status = 'active'
      and alert_price >= ${finalAmount}
  `;

  let notified = 0;
  for (const match of matches) {
    const email = await getCustomerEmail(sql, match.customer_id);
    if (!email) {
      continue;
    }

    const description = `${context.cardName} (${context.setName}, ${context.finish})`;
    const priceText = `${currency} ${finalAmount.toFixed(2)}`;
    const thresholdText = `${currency} ${Number(match.alert_price).toFixed(2)}`;
    await emailProvider.sendEmail({
      to: email,
      subject: `Price drop: ${context.cardName}`,
      html: `<p>${description} is now ${priceText}, at or below your alert price of ${thresholdText}.</p>`,
      text: `${description} is now ${priceText}, at or below your alert price of ${thresholdText}.`,
    });

    await sql`
      update price_alerts
      set status = 'triggered', triggered_at = now(), updated_at = now()
      where id = ${match.id}
    `;
    notified += 1;
  }

  return notified;
}
