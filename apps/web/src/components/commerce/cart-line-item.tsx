import { AlertCircle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

interface CartLineItemProps {
  line: CartLine;
}

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function CartLineItem({ line }: CartLineItemProps) {
  const priceChanged = line.currentPrice && line.currentPrice !== line.priceAtAdd;
  const priceIncreased = priceChanged && (line.currentPrice || 0) > line.priceAtAdd;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="flex items-start gap-2">
            <div>
              <h3 className="font-medium">{line.cardName}</h3>
              <p className="text-xs text-muted-foreground">
                {line.setCode} · {line.rarity}
                {line.finish !== "nonfoil" && (
                  <>
                    {" "}
                    <Badge variant="outline" className="ml-1">
                      {line.finish === "foil" ? "Foil" : "Etched"}
                    </Badge>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Condition: {line.condition.toUpperCase()}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {priceChanged && (
              <div className="flex items-center gap-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
                <AlertCircle className="size-4 shrink-0" />
                <span>
                  Price changed from {priceFormatter.format(line.priceAtAdd)} to{" "}
                  {priceFormatter.format(line.currentPrice || 0)}
                  {priceIncreased ? " ↑" : " ↓"}
                </span>
              </div>
            )}

            {!line.isAvailable && (
              <div className="flex items-center gap-2 rounded bg-red-50 p-2 text-xs text-red-900">
                <AlertCircle className="size-4 shrink-0" />
                <span>This item is no longer available</span>
              </div>
            )}

            {line.isAvailable && (
              <p className="text-xs text-muted-foreground">
                Reserved until {dateFormatter.format(new Date(line.reservationExpiresAt))}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 text-right">
          <div className="text-lg font-semibold">
            {priceFormatter.format((line.currentPrice || line.priceAtAdd) * line.quantity)}
          </div>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
              −
            </Button>
            <Input
              type="number"
              min="1"
              value={line.quantity}
              className="h-8 w-12 text-center p-0"
              readOnly
            />
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled>
              +
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive"
            disabled
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
