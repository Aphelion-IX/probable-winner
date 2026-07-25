-- Records who an order belongs to, so checkout can authorise access to it.
--
-- orders.customer_id has existed since 20260723081706 but createPendingOrder()
-- never populated it, so every order was created ownerless. Two consequences:
--
--   1. orders_select_customer (`customer_id = auth.uid()`) matched nothing,
--      so a signed-in customer could never see their own order -- the
--      account order-history screen was permanently empty.
--   2. Nothing recorded who a *guest* order belonged to at all, so there was
--      no fact to authorise against when someone asked to pay for an order
--      by id.
--
-- carts already solved the same problem with a two-owner model
-- (20260723070153): customer_id for a signed-in customer, guest_token for
-- an anonymous one, with exactly one of the two set. Orders now mirror it.
--
-- Deliberately NOT a unique index, unlike carts_active_guest_uq: a cart is
-- "the one active basket for this guest", but a guest may legitimately place
-- many orders over the lifetime of their session cookie.
--
-- No RLS policy accompanies this column. A guest is anonymous by definition,
-- so `auth.uid()` cannot identify them and no policy could express "the
-- holder of this cookie" -- guest access is checked server-side against the
-- httpOnly cart_session_id cookie, exactly as guest carts already are (see
-- getOrCreateCart / get_cart_contents, which take the token as a parameter
-- for the same reason).
alter table orders add column if not exists guest_token uuid;

create index if not exists orders_guest_token_idx on orders (guest_token)
  where guest_token is not null;

-- Mirrors carts_exactly_one_owner, but permits neither being set: orders
-- created before this migration are ownerless and cannot be retro-assigned
-- (the information was never captured). Those stay unclaimable by design --
-- the checkout ownership check fails closed on them.
alter table orders drop constraint if exists orders_at_most_one_owner;
alter table orders add constraint orders_at_most_one_owner check (
  customer_id is null or guest_token is null
);
