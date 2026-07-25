import { describe, expect, it } from "vitest";

import { ownsResource, type CheckoutIdentity } from "./checkout-ownership";

const CUSTOMER: CheckoutIdentity = { userId: "customer-1", guestToken: null };
const GUEST: CheckoutIdentity = { userId: null, guestToken: "token-1" };
const NOBODY: CheckoutIdentity = { userId: null, guestToken: null };

describe("ownsResource", () => {
  it("lets a customer own their own resource", () => {
    expect(ownsResource({ customer_id: "customer-1", guest_token: null }, CUSTOMER)).toBe(true);
  });

  it("refuses a customer another customer's resource", () => {
    expect(ownsResource({ customer_id: "customer-2", guest_token: null }, CUSTOMER)).toBe(false);
  });

  it("lets a guest holding the matching token own the resource", () => {
    expect(ownsResource({ customer_id: null, guest_token: "token-1" }, GUEST)).toBe(true);
  });

  it("refuses a guest holding a different token", () => {
    expect(ownsResource({ customer_id: null, guest_token: "token-2" }, GUEST)).toBe(false);
  });

  // The two degenerate cases that a naive `a === b` check would get wrong,
  // both of which would hand over someone else's basket or order.
  it("refuses an ownerless resource rather than matching null against null", () => {
    expect(ownsResource({ customer_id: null, guest_token: null }, NOBODY)).toBe(false);
    expect(ownsResource({ customer_id: null, guest_token: null }, CUSTOMER)).toBe(false);
    expect(ownsResource({ customer_id: null, guest_token: null }, GUEST)).toBe(false);
  });

  it("refuses a caller with no identity at all", () => {
    expect(ownsResource({ customer_id: "customer-1", guest_token: null }, NOBODY)).toBe(false);
    expect(ownsResource({ customer_id: null, guest_token: "token-1" }, NOBODY)).toBe(false);
  });

  it("does not let a signed-in customer claim a guest resource by holding no token", () => {
    expect(ownsResource({ customer_id: null, guest_token: "token-1" }, CUSTOMER)).toBe(false);
  });

  it("lets a signed-in customer who still holds the guest cookie own their pre-login resource", () => {
    // A customer who built a basket before signing in still legitimately
    // holds that cookie; the cart itself already treats it as proof.
    expect(
      ownsResource(
        { customer_id: null, guest_token: "token-1" },
        { userId: "customer-1", guestToken: "token-1" },
      ),
    ).toBe(true);
  });
});
