# Business Rules and Status Enums

This document enumerates every valid state for orders, transfers, and reservations with allowed transitions.

## Order Status Lifecycle

An order progresses from creation through payment, picking, packing, and shipment to final delivery or cancellation.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Order Lifecycle                            │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   Pending    │  (cart converted to order)
                    │              │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │     Paid     │  (Stripe webhook confirmed)
                    │              │
                    └──────┬───────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ▼                             ▼
      ┌──────────────┐            ┌──────────────┐
      │   Picking    │            │  Cancelled   │  (staff/customer cancel)
      │              │            │   (no pick)  │
      └──────┬───────┘            └──────────────┘
             │
             ▼
      ┌──────────────┐
      │   Packed     │  (all lines picked & packed)
      │              │
      └──────┬───────┘
             │
             ▼
      ┌──────────────┐
      │  Dispatched  │  (handed to carrier)
      │              │
      └──────┬───────┘
             │
             ▼
      ┌──────────────┐
      │   Shipped    │  (in transit)
      │              │
      └──────┬───────┘
             │
             ▼
      ┌──────────────┐
      │  Delivered   │  (recipient confirmed)
      │              │
      └──────────────┘
```

**Status values:**
- `pending` — created from cart, awaiting payment
- `paid` — payment confirmed via Stripe webhook
- `picking` — warehouse picking in progress
- `packed` — all lines picked and packed, ready to dispatch
- `dispatched` — handed off to shipping carrier
- `shipped` — in transit (tracking available)
- `delivered` — recipient confirmed delivery
- `cancelled` — order cancelled (no picking started) or refunded (after delivery)

**Allowed transitions:**
- `pending` → `paid` (payment confirmed)
- `pending` → `cancelled` (payment failed, or customer cancelled before payment)
- `paid` → `picking` (warehouse begins picking)
- `paid` → `cancelled` (customer cancels after payment, before picking starts)
- `picking` → `packed` (all lines picked)
- `picking` → `cancelled` (warehouse stops picking due to stock issue; refund issued)
- `packed` → `dispatched` (carrier pickup confirmed)
- `dispatched` → `shipped` (carrier reports in-transit)
- `shipped` → `delivered` (tracking event or customer confirmation)
- `delivered` → `cancelled` (refund after delivery)

**Invalid transitions:**
All others, including:
- Direct `pending` → `picking` (must go through `paid`)
- `shipped` → `picking` (cannot restart picking after dispatch)
- `cancelled` → anything (terminal state)

## Transfer Order Status Lifecycle

A transfer order manages inter-store stock movements with a state machine enforcing dispatch/receive discipline.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Transfer Lifecycle                           │
└─────────────────────────────────────────────────────────────────┘

            ┌──────────────┐
            │    Draft     │  (not yet submitted)
            │              │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │  Requested   │  (dispatch node pending approval)
            │              │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │  Accepted    │  (dispatch node approved)
            │              │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │   Picking    │  (dispatch node picking stock)
            │              │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │  Dispatched  │  (stock handed over, now unavailable at dispatch)
            │              │
            └──────┬───────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
   ┌──────────────┐    ┌──────────────┐
   │   In-Transit │    │  Partially   │  (receive begins, some lines short)
   │              │    │   Received   │
   └──────┬───────┘    └──────┬───────┘
          │                   │
          └───────────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │   Received   │  (all lines received or reconciled short)
               │              │
               └──────────────┘
```

**Status values:**
- `draft` — not yet submitted for approval
- `requested` — awaiting dispatch node acceptance
- `accepted` — dispatch node approved the transfer
- `picking` — dispatch node picking stock
- `dispatched` — stock handed over; no longer available at dispatch node
- `in_transit` — stock in transit to receiving node
- `partially_received` — receiving node started receiving; some lines received, some pending
- `received` — all lines received (or reconciled as short/damaged)

**Allowed transitions:**
- `draft` → `requested` (submit for approval)
- `draft` → (deleted, not tracked)
- `requested` → `accepted` (dispatch node approves)
- `requested` → `draft` (cancel before acceptance)
- `accepted` → `picking` (dispatch node begins picking)
- `picking` → `dispatched` (stock handed over)
- `dispatched` → `in_transit` (carrier pickup confirmed)
- `in_transit` → `partially_received` (receiving node starts receiving)
- `in_transit` → `received` (all lines received without partial)
- `partially_received` → `received` (receiving node completes partial receipt)

**Invariant:** Stock is never available at both dispatch and receive simultaneously. Once `dispatched`, the stock is locked at the dispatch node (unavailable for sale) and reserved for the receiving node.

## Reservation Lifecycle

A reservation holds stock for a customer's order. It expires after a configurable duration (default 30 minutes) and is automatically released.

```
┌─────────────────────────────────────────────────────────────────┐
│                  Reservation Lifecycle                          │
└─────────────────────────────────────────────────────────────────┘

            ┌──────────────┐
            │   Active     │  (stock reserved)
            │              │
            └──────┬───────┘
                   │
         ┌─────────┴────────┬──────────────┐
         │                  │              │
         ▼                  ▼              ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │   Allocated  │  │   Released   │  │   Expired    │
    │  (→ picking) │  │   (manual)   │  │ (auto-expiry)│
    │              │  │              │  │              │
    └──────────────┘  └──────────────┘  └──────────────┘
```

**Status values:**
- `active` — stock reserved for a cart/order
- `allocated` — reservation converted to order allocation (picking workflow)
- `released` — manually released (e.g., cart abandoned, customer changed mind)
- `expired` — automatically released due to inactivity (TTL exceeded)

**Allowed transitions:**
- `active` → `allocated` (order paid, inventory picking begins)
- `active` → `released` (customer or staff manually release)
- `active` → `expired` (automatic expiry after TTL, no action required)
- `allocated` → (terminal, moves to inventory movements ledger)
- `released` → (terminal)
- `expired` → (terminal)

**Expiry behavior:**
- Default TTL: 30 minutes from reservation creation
- Automatic release: Supabase Cron job (`reservation_cleanup`) runs every 1 minute
- Impact: Stock becomes available to other customers again
- No manual action required; expired rows remain for audit trail

## Inventory Movement Types

All inventory changes are recorded as immutable movements in the `inventory_movements` ledger. Balances are derived from the ledger, never edited directly.

**Movement types:**
- `receive` — receiving stock from supplier
- `adjust` — manual quantity correction
- `reserve` — customer cart reservation
- `release_reservation` — cancelled or expired reservation
- `allocate` — converting reservation to order allocation
- `pick` — warehouse worker picking for an order
- `pack` — warehouse worker packing picked items
- `transfer_dispatch` — inter-store transfer dispatched
- `transfer_receive` — inter-store transfer received
- `quarantine` — marking stock as unusable (damage, defect)
- `stocktake_adjustment` — variance from physical count
