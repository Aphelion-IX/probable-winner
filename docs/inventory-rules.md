# Inventory Rules

Backlog B-002. Defines the availability formula, reservation duration, and
quarantine rules that every inventory atomic function (blueprint §9.3,
backlog B-060+) must implement exactly. Treat any mismatch between this
document and the implementation as a bug against this document, not the
other way around.

## Availability formula

```
quantity_available_online =
  quantity_on_hand
  - quantity_reserved
  - quantity_allocated
  - quantity_quarantined
  - quantity_safety_stock
```

`quantity_available_online` on `inventory_balances` is a maintained column,
not computed at read time (blueprint §9.1: "do not calculate live
availability by summing the full movement ledger whenever a customer opens
a page"). Every atomic function that changes one of the five inputs must
update `quantity_available_online` by the same delta, in the same
transaction, so the column never drifts out of sync with the formula above.

As of backlog B-061, only `quantity_on_hand` is mutated (by
`receive_inventory()`/`adjust_inventory()`), so `quantity_available_online`
currently just tracks `quantity_on_hand` 1:1 — `quantity_reserved`,
`quantity_allocated`, `quantity_quarantined`, and `quantity_safety_stock`
all stay at 0 until B-062/B-063/B-064 add the functions that populate them.
`reserve_inventory()` (B-062) is the first function where the formula
actually matters: it must reject a reservation that would take
`quantity_available_online` below zero.

## Reservation duration

Reservations default to a **15 minute** hold from creation
(`expires_at = now() + interval '15 minutes'`), matching a typical
add-to-cart-through-checkout window. A scheduled job (backlog B-112)
releases expired reservations on a schedule — an expired reservation is not
auto-released the instant it lapses, so `quantity_available_online` should
be read as "available assuming expired-but-unreleased reservations get
cleared shortly," not as an instantaneous guarantee.

Reservation statuses (blueprint §10): `active`, `converted`, `released`,
`expired`, `cancelled`. Only an `active` reservation holds stock (counted in
`quantity_reserved`); every other status means the hold has already been
released back to `quantity_available_online` (or, for `converted`, moved
into `quantity_allocated` via `allocate_order_inventory()`, B-063).

Releasing an already-released (or expired/cancelled/converted) reservation
is a no-op, not an error — a reservation's terminal states are terminal,
and calling release twice must not double-release stock back to
`quantity_reserved`... i.e. must not decrement `quantity_reserved` twice
for the same reservation.

## Quarantine rules

Quarantined stock (`quantity_quarantined`) is physically on hand
(`quantity_on_hand` includes it) but excluded from
`quantity_available_online` and from every reservation/allocation path —
a quarantined unit cannot be reserved even though `quantity_on_hand` is
nonzero. Moving stock into or out of quarantine is a transfer between the
`quantity_on_hand`-adjacent buckets (`quantity_quarantined` up,
`quantity_available_online` down, and vice versa on release), not a net
change to `quantity_on_hand` itself — unlike `adjust_inventory()`'s
`damage` movement type, which is a genuine loss. Quarantine handling is
implemented in backlog B-064, not B-061's `adjust_inventory()`.
