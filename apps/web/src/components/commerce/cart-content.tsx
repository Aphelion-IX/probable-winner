import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { CartLineItem } from "@/components/commerce/cart-line-item";
import { getCartContents } from "@/features/cart/queries/get-cart-contents";

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export async function CartContent() {
  const cart = await getCartContents();

  if (cart.lines.length === 0) {
    return (
      <div className="mt-12 space-y-6">
        <div className="rounded-lg border border-dashed p-12 text-center">
          <h2 className="text-lg font-semibold">Your cart is empty</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse our catalogue and add some cards to get started.
          </p>
          <Link
            href="/search"
            className="inline-flex w-full justify-center rounded-lg border border-transparent bg-primary px-2.5 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="space-y-4">
          {cart.lines.map((line) => (
            <CartLineItem key={line.cartLineId} line={line} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border p-6">
          <h3 className="font-semibold">Order summary</h3>
          <Separator className="my-4" />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{priceFormatter.format(cart.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span>Calculated at checkout</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>Calculated at checkout</span>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{priceFormatter.format(cart.subtotal)}</span>
          </div>

          <Link
            href="/checkout"
            className="mt-6 inline-flex w-full justify-center rounded-lg border border-transparent bg-primary px-2.5 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Proceed to checkout
          </Link>
        </div>

        <Link
          href="/search"
          className="inline-flex w-full justify-center rounded-lg border border-border bg-background px-2.5 py-2 text-sm font-medium transition-all hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
