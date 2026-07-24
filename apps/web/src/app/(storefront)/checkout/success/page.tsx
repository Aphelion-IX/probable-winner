"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");

    const verifyPayment = async () => {
      if (!sessionId) {
        setStatus("error");
        setErrorMessage("Invalid session");
        return;
      }

      try {
        const response = await fetch("/api/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        const data = await response.json();

        if (data.success) {
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMessage(data.error || "Payment verification failed");
        }
      } catch (error) {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "An error occurred");
      }
    };

    verifyPayment();
  }, [searchParams]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Confirming your payment...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <h1 className="text-lg font-semibold mb-2">Payment Error</h1>
          <p className="text-sm text-muted-foreground mb-4">
            {errorMessage || "There was an error processing your payment. Please try again."}
          </p>
          <button
            onClick={() => router.push("/checkout")}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Return to Checkout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center max-w-md">
        <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
        <h1 className="text-lg font-semibold mb-2">Payment Successful</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Your order has been confirmed and will be processed shortly.
        </p>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Return to Home
        </button>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
