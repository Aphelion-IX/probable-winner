"use client";

import { useEffect, useMemo, useState } from "react";

import type { SkuOption } from "@/features/catalogue/queries/list-sku-options";
import { RestockAlertButton } from "@/features/catalogue/components/restock-alert-button";

type SkuSelectorProps = {
  printingId: string;
  options: SkuOption[];
};

type LiveData = {
  price: number | null;
  currency: string | null;
  availableQuantity: number;
};

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
}

const selectClassName =
  "rounded-md border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SkuSelector({ printingId, options }: SkuSelectorProps) {
  const languages = useMemo(() => uniqueBy(options, (option) => option.languageCode), [options]);
  const finishes = useMemo(() => uniqueBy(options, (option) => option.finishCode), [options]);
  const conditions = useMemo(() => uniqueBy(options, (option) => option.conditionCode), [options]);

  const [languageCode, setLanguageCode] = useState(options[0]?.languageCode ?? "");
  const [finishCode, setFinishCode] = useState(options[0]?.finishCode ?? "");
  const [conditionCode, setConditionCode] = useState(options[0]?.conditionCode ?? "");

  const selected = useMemo(
    () =>
      options.find(
        (option) =>
          option.languageCode === languageCode &&
          option.finishCode === finishCode &&
          option.conditionCode === conditionCode,
      ) ?? null,
    [options, languageCode, finishCode, conditionCode],
  );

  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      return;
    }

    let cancelled = false;

    async function loadLiveData(skuId: string) {
      setLoading(true);
      setLiveData(null);

      try {
        const response = await fetch(`/api/sellable-skus/${skuId}`, { cache: "no-store" });
        const data = response.ok ? ((await response.json()) as LiveData) : null;
        if (!cancelled) setLiveData(data);
      } catch {
        if (!cancelled) setLiveData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadLiveData(selected.skuId);

    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        This printing isn&apos;t available for sale yet.
      </div>
    );
  }

  const priceFormatter = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: liveData?.currency ?? "AUD",
  });

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4" data-testid="sku-selector">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Language</span>
          <select
            className={selectClassName}
            value={languageCode}
            onChange={(event) => setLanguageCode(event.target.value)}
          >
            {languages.map((option) => (
              <option key={option.languageCode} value={option.languageCode}>
                {option.languageName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Finish</span>
          <select
            className={selectClassName}
            value={finishCode}
            onChange={(event) => setFinishCode(event.target.value)}
          >
            {finishes.map((option) => (
              <option key={option.finishCode} value={option.finishCode}>
                {option.finishName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Condition</span>
          <select
            className={selectClassName}
            value={conditionCode}
            onChange={(event) => setConditionCode(event.target.value)}
          >
            {conditions.map((option) => (
              <option key={option.conditionCode} value={option.conditionCode}>
                {option.conditionName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selected ? (
        <p className="text-sm text-muted-foreground" data-testid="sku-unavailable">
          This combination isn&apos;t available.
        </p>
      ) : (
        <div data-testid="sku-live-data" aria-busy={loading} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">
              {liveData?.price != null
                ? priceFormatter.format(liveData.price)
                : "Price unavailable"}
            </span>
            <span className="text-sm text-muted-foreground">
              {liveData
                ? liveData.availableQuantity > 0
                  ? `${liveData.availableQuantity} in stock`
                  : "Out of stock"
                : loading
                  ? "Loading…"
                  : ""}
            </span>
          </div>

          {liveData && liveData.availableQuantity === 0 && (
            <RestockAlertButton
              printingId={printingId}
              finishCode={selected.finishCode}
              conditionCode={selected.conditionCode}
            />
          )}
        </div>
      )}
    </div>
  );
}
