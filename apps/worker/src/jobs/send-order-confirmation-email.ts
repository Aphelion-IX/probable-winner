import type { Sql } from "postgres";

import type { EmailProvider } from "../integrations/email/types.js";

type OrderRow = {
  order_number: string;
  total_amount: number;
  currency: string;
  fulfilment_type: string;
  customer_id: string | null;
  guest_email: string | null;
};

type OrderLineRow = {
  card_name: string;
  quantity: number;
  line_total: number;
};

async function resolveRecipientEmail(sql: Sql, order: OrderRow): Promise<string | null> {
  if (!order.customer_id) {
    return order.guest_email;
  }

  const [customer] = await sql<{ email: string | null }[]>`
    select email from auth.users where id = ${order.customer_id}
  `;
  return customer?.email ?? null;
}

// Sends the confirmation email a paid order has never actually triggered
// (backlog: the "email" pgmq queue existed since migration 20260722120349
// but nothing ever wrote a message to it). Returns false (not an error)
// when there is no recipient to email -- a guest order placed before
// orders.guest_email existed, or a genuinely deleted auth.users row -- so
// the caller can log that distinctly from a real failure.
export async function sendOrderConfirmationEmail(
  sql: Sql,
  emailProvider: EmailProvider,
  orderId: string,
): Promise<boolean> {
  const [order] = await sql<OrderRow[]>`
    select order_number, total_amount, currency, fulfilment_type, customer_id, guest_email
    from orders
    where id = ${orderId}
  `;

  if (!order) {
    return false;
  }

  const recipientEmail = await resolveRecipientEmail(sql, order);
  if (!recipientEmail) {
    return false;
  }

  const lines = await sql<OrderLineRow[]>`
    select oc.name as card_name, ol.quantity, ol.line_total
    from order_lines ol
    join sellable_skus sk on sk.id = ol.sellable_sku_id
    join card_printings cp on cp.id = sk.card_printing_id
    join oracle_cards oc on oc.id = cp.oracle_card_id
    where ol.order_id = ${orderId}
    order by ol.created_at asc
  `;

  const fulfilmentText =
    order.fulfilment_type === "click_and_collect" ? "Click and collect" : "Delivery";
  const totalText = `${order.currency} ${Number(order.total_amount).toFixed(2)}`;

  const lineText = lines
    .map(
      (line) =>
        `${line.quantity} x ${line.card_name} - ${order.currency} ${Number(line.line_total).toFixed(2)}`,
    )
    .join("\n");
  const lineHtml = lines
    .map(
      (line) =>
        `<li>${line.quantity} x ${line.card_name} - ${order.currency} ${Number(line.line_total).toFixed(2)}</li>`,
    )
    .join("");

  await emailProvider.sendEmail({
    to: recipientEmail,
    subject: `Order confirmed: #${order.order_number}`,
    html: `<p>Thanks for your order #${order.order_number}!</p><ul>${lineHtml}</ul><p>${fulfilmentText} — total ${totalText}.</p>`,
    text: `Thanks for your order #${order.order_number}!\n\n${lineText}\n\n${fulfilmentText} — total ${totalText}.`,
  });

  return true;
}
