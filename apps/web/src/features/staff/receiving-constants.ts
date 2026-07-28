// Plain module (no "use server"): a "use server" file may only export async
// functions (same reasoning as inventory-movement-types.ts), so this shared
// constant lives here and is imported by both the action module and the
// receiving screen.

/**
 * Upper bound on how many lines one bulk-receive call will process. Exists
 * to keep a single request's worth of sequential receive_inventory() RPCs
 * bounded rather than unbounded -- a real shipment this large should be
 * split into more than one upload/scan session.
 */
export const MAX_BULK_RECEIVE_LINES = 500;
