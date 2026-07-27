import type { Sql } from "postgres";

import type { EmailProvider } from "../integrations/email/types.js";

type OrderRow = {
  order_number: string;
  customer_id: string | null;
  guest_email: string | null;
};

type ShipmentRow = {
  tracking_number: string | null;
  carrier: string | null;
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

// Sends the "your order shipped" notification mark_shipment_shipped()
// triggers (migration 20260727070000_shipment_notification_email.sql).
// Same recipient resolution as sendOrderConfirmationEmail: an
// authenticated customer's real account email, or a guest's captured
// orders.guest_email -- never sent if neither is available.
export async function sendShipmentNotificationEmail(
  sql: Sql,
  emailProvider: EmailProvider,
  orderId: string,
): Promise<boolean> {
  const [order] = await sql<OrderRow[]>`
    select order_number, customer_id, guest_email
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

  const [shipment] = await sql<ShipmentRow[]>`
    select tracking_number, carrier from shipments where order_id = ${orderId}
  `;

  const trackingText = shipment?.tracking_number
    ? `Tracking number: ${shipment.tracking_number}${shipment.carrier ? ` (${shipment.carrier})` : ""}.`
    : "";

  await emailProvider.sendEmail({
    to: recipientEmail,
    subject: `Your order has shipped: #${order.order_number}`,
    html: `<p>Your order #${order.order_number} is on its way.</p>${
      trackingText ? `<p>${trackingText}</p>` : ""
    }`,
    text: `Your order #${order.order_number} is on its way.\n\n${trackingText}`,
  });

  return true;
}
