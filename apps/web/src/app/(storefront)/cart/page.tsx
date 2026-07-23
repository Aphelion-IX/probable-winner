import { Suspense } from "react";
import { CartContent } from "@/components/commerce/cart-content";
import { CartSkeleton } from "@/components/commerce/cart-skeleton";

export default function CartPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 className="text-3xl font-semibold">Shopping cart</h1>

      <Suspense fallback={<CartSkeleton />}>
        <CartContent />
      </Suspense>
    </div>
  );
}
