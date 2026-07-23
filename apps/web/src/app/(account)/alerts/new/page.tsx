"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPriceAlert, createRestockAlert } from "@/features/customer/actions/manage-alerts";
import { ArrowLeft } from "lucide-react";

type AlertType = "price" | "restock";
type Finish = "normal" | "foil" | "etched";
type Condition = "NM" | "LP" | "MP" | "HP";

const finishOptions: Array<{ value: Finish; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" },
];

const conditionOptions: Array<{ value: Condition; label: string }> = [
  { value: "NM", label: "Near Mint (NM)" },
  { value: "LP", label: "Lightly Played (LP)" },
  { value: "MP", label: "Moderately Played (MP)" },
  { value: "HP", label: "Heavily Played (HP)" },
];

export default function CreateAlertPage() {
  const router = useRouter();
  const [alertType, setAlertType] = useState<AlertType>("price");
  const [cardName, setCardName] = useState("");
  const [finish, setFinish] = useState<Finish>("normal");
  const [alertPrice, setAlertPrice] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [condition, setCondition] = useState<Condition>("NM");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Mock card printing ID for now (in production, would search actual cards)
      const mockCardId = "00000000-0000-0000-0000-000000000001";

      if (alertType === "price") {
        if (!alertPrice) {
          throw new Error("Alert price is required");
        }
        await createPriceAlert(mockCardId, finish, parseFloat(alertPrice), currency);
      } else {
        await createRestockAlert(mockCardId, finish, condition);
      }

      router.push("/account/alerts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert");
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link href="/account/alerts" className="inline-flex items-center gap-2 text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to Alerts
      </Link>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create New Alert</h1>
        <p className="mt-2 text-sm text-muted-foreground">Set up a price or restock alert for a card.</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-6 rounded-lg border p-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-semibold">Alert Type</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="price"
                checked={alertType === "price"}
                onChange={(e) => setAlertType(e.target.value as AlertType)}
                disabled={isLoading}
              />
              <span className="text-sm">Price Alert</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="restock"
                checked={alertType === "restock"}
                onChange={(e) => setAlertType(e.target.value as AlertType)}
                disabled={isLoading}
              />
              <span className="text-sm">Restock Alert</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="cardName" className="block text-sm font-semibold">
            Card Name
          </label>
          <input
            id="cardName"
            type="text"
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            placeholder="Search for a card..."
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={isLoading}
            required
          />
          <p className="text-xs text-muted-foreground">Start typing to search available cards</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="finish" className="block text-sm font-semibold">
            Finish
          </label>
          <select
            id="finish"
            value={finish}
            onChange={(e) => setFinish(e.target.value as Finish)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            disabled={isLoading}
          >
            {finishOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {alertType === "price" && (
          <>
            <div className="space-y-2">
              <label htmlFor="alertPrice" className="block text-sm font-semibold">
                Alert When Price Reaches
              </label>
              <div className="flex gap-2">
                <input
                  id="alertPrice"
                  type="number"
                  value={alertPrice}
                  onChange={(e) => setAlertPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                  disabled={isLoading}
                  required
                />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm"
                  disabled={isLoading}
                >
                  <option value="AUD">AUD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
          </>
        )}

        {alertType === "restock" && (
          <div className="space-y-2">
            <label htmlFor="condition" className="block text-sm font-semibold">
              Condition
            </label>
            <select
              id="condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value as Condition)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              disabled={isLoading}
            >
              {conditionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isLoading || !cardName}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "Creating..." : "Create Alert"}
          </button>
          <Link
            href="/account/alerts"
            className="flex items-center justify-center rounded-lg border px-4 py-2 font-semibold hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
