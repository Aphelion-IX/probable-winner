import { Suspense } from "react";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { CheckoutSkeleton } from "@/components/checkout/checkout-skeleton";
import { getCartContents } from "@/features/cart/queries/get-cart-contents";
import { listClickAndCollectStores } from "@/features/customer/queries/list-click-and-collect-stores";

// Reads the cart session cookie and/or the authenticated user -- cannot be
// statically prerendered.
export const dynamic = "force-dynamic";

async function CheckoutContentLoader() {
  const [cart, clickAndCollectStores] = await Promise.all([
    getCartContents(),
    listClickAndCollectStores(),
  ]);

  return <CheckoutContent cart={cart} clickAndCollectStores={clickAndCollectStores} />;
}

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 className="text-3xl font-semibold">Checkout</h1>

      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContentLoader />
      </Suspense>
    </div>
  );
}
