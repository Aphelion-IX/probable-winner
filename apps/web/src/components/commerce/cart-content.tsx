import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { CartLineItem } from "@/components/commerce/cart-line-item";

interface CartLine {
  id: string;
  sellableSkuId: string;
  quantity: number;
  priceAtAdd: number;
  cardName: string;
  setCode: string;
  rarity: string;
  condition: string;
  finish: string;
  reservationId: string;
  reservationExpiresAt: string;
  currentPrice?: number;
  isAvailable: boolean;
}

interface CartData {
  cartId: string;
  lines: CartLine[];
  totalPrice: number;
  hasWarnings: boolean;
}

async function getCartData(): Promise<CartData | null> {
  // Mock implementation - in production, fetch from API or server action
  // For now, return null to show empty cart state
  return null;
}

export async function CartContent() {
  const cartData = await getCartData();

  if (!cartData || cartData.lines.length === 0) {
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

  const priceFormatter = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  });

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {cartData.hasWarnings && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">
              ⚠️ Some items in your cart have changed. Please review the changes below.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {cartData.lines.map((line) => (
            <CartLineItem key={line.id} line={line} />
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
              <span>{priceFormatter.format(cartData.totalPrice)}</span>
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
            <span>{priceFormatter.format(cartData.totalPrice)}</span>
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
