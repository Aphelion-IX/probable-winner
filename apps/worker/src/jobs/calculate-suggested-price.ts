import type { Sql } from "postgres";

export type ModifierType = "percentage" | "flat";
export type Modifier = { type: ModifierType; value: number } | null;

export type CalculateSuggestedPriceInput = {
  baseAmount: number;
  baseCurrency: string;
  targetCurrency: string;
  // Multiplies baseAmount to get the target-currency amount; 1 when
  // baseCurrency already equals targetCurrency (no lookup needed).
  exchangeRate: number;
  marginType: ModifierType;
  marginValue: number;
  conditionModifier: Modifier;
  stockModifier: Modifier;
};

export type CalculateSuggestedPriceResult = {
  baseAmount: number;
  baseCurrency: string;
  exchangeRate: number;
  convertedAmount: number;
  marginAmount: number;
  conditionModifierAmount: number;
  stockModifierAmount: number;
  finalAmount: number;
  currency: string;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function applyModifier(amount: number, modifier: Modifier): number {
  if (!modifier) return 0;
  return round2(modifier.type === "percentage" ? amount * (modifier.value / 100) : modifier.value);
}

// Pure calculation (backlog B-161's core AC: every suggested price is
// traceable to the rule/inputs that produced it -- so every intermediate
// amount is returned, not just finalAmount, matching calculated_prices'
// column-per-component schema from B-160). Applied in a fixed order —
// currency conversion, then margin, then condition modifier, then stock
// modifier — each percentage modifier compounding on the running total
// rather than all being percentages of the original base amount, since a
// margin is meant to be "on top of" the converted price and a condition
// discount is meant to be "off of" the margined retail price, not off the
// wholesale base.
export function calculateSuggestedPrice(
  input: CalculateSuggestedPriceInput,
): CalculateSuggestedPriceResult {
  const convertedAmount = round2(input.baseAmount * input.exchangeRate);

  const marginAmount = applyModifier(convertedAmount, {
    type: input.marginType,
    value: input.marginValue,
  });
  const afterMargin = convertedAmount + marginAmount;

  const conditionModifierAmount = applyModifier(afterMargin, input.conditionModifier);
  const afterCondition = afterMargin + conditionModifierAmount;

  const stockModifierAmount = applyModifier(afterCondition, input.stockModifier);
  const afterStock = afterCondition + stockModifierAmount;

  // final_amount has a >= 0 check constraint (20260723080512) -- an
  // aggressive discount stack must floor at zero rather than producing a
  // negative suggested price the database would reject.
  const finalAmount = Math.max(0, round2(afterStock));

  return {
    baseAmount: input.baseAmount,
    baseCurrency: input.baseCurrency,
    exchangeRate: input.exchangeRate,
    convertedAmount,
    marginAmount,
    conditionModifierAmount,
    stockModifierAmount,
    finalAmount,
    currency: input.targetCurrency,
  };
}

export type CalculateAndStoreResult = {
  calculatedPriceId: string;
  result: CalculateSuggestedPriceResult;
};

// DB IO: gathers the real inputs (latest matching price_snapshots row,
// latest exchange rate, the rule's condition/stock modifier for this SKU's
// condition/current org-wide stock) and stores the result, with a
// calculated_price_inputs row linking back to the source snapshot(s) so
// the "staff can explain any price" AC (blueprint §17) holds from the
// stored row alone, not just at calculation time.
export async function calculateAndStoreSuggestedPrice(
  sql: Sql,
  pricingRuleId: string,
  sellableSkuId: string,
): Promise<CalculateAndStoreResult> {
  const [rule] = await sql<
    {
      source_price_type: string;
      target_currency: string;
      margin_type: ModifierType;
      margin_value: number;
    }[]
  >`
    select source_price_type, target_currency, margin_type, margin_value
    from pricing_rules where id = ${pricingRuleId}
  `;
  if (!rule) {
    throw new Error(`calculateAndStoreSuggestedPrice: unknown pricing_rule ${pricingRuleId}`);
  }

  const [sku] = await sql<
    { card_printing_id: string; finish_code: string; condition_code: string }[]
  >`
    select sk.card_printing_id, f.code as finish_code, c.code as condition_code
    from sellable_skus sk
    join finishes f on f.id = sk.finish_id
    join conditions c on c.id = sk.condition_id
    where sk.id = ${sellableSkuId}
  `;
  if (!sku) {
    throw new Error(`calculateAndStoreSuggestedPrice: unknown sellable_sku ${sellableSkuId}`);
  }

  const [snapshot] = await sql<{ id: string; amount: string; currency: string }[]>`
    select id, amount, currency
    from price_snapshots
    where card_printing_id = ${sku.card_printing_id}
      and finish = ${sku.finish_code}
      and price_type = ${rule.source_price_type}
    order by observed_at desc
    limit 1
  `;
  if (!snapshot) {
    throw new Error(
      `calculateAndStoreSuggestedPrice: no ${rule.source_price_type} price_snapshots row for printing ${sku.card_printing_id}/${sku.finish_code}`,
    );
  }

  let exchangeRate = 1;
  if (snapshot.currency !== rule.target_currency) {
    const [rateRow] = await sql<{ rate: string }[]>`
      select rate from exchange_rates
      where base_currency = ${snapshot.currency} and target_currency = ${rule.target_currency}
      order by observed_at desc
      limit 1
    `;
    if (!rateRow) {
      throw new Error(
        `calculateAndStoreSuggestedPrice: no exchange rate for ${snapshot.currency} -> ${rule.target_currency}`,
      );
    }
    exchangeRate = Number(rateRow.rate);
  }

  const [conditionModifierRow] = await sql<
    { modifier_type: ModifierType; modifier_value: string }[]
  >`
    select modifier_type, modifier_value from pricing_condition_modifiers
    where pricing_rule_id = ${pricingRuleId} and condition = ${sku.condition_code}
  `;
  const conditionModifier: Modifier = conditionModifierRow
    ? {
        type: conditionModifierRow.modifier_type,
        value: Number(conditionModifierRow.modifier_value),
      }
    : null;

  const [{ total_on_hand: totalOnHand }] = await sql<{ total_on_hand: string }[]>`
    select coalesce(sum(quantity_on_hand), 0)::text as total_on_hand
    from inventory_balances where sellable_sku_id = ${sellableSkuId}
  `;
  const [stockModifierRow] = await sql<{ modifier_type: ModifierType; modifier_value: string }[]>`
    select modifier_type, modifier_value from pricing_stock_modifiers
    where pricing_rule_id = ${pricingRuleId}
      and min_quantity <= ${Number(totalOnHand)}
      and (max_quantity is null or max_quantity >= ${Number(totalOnHand)})
    order by min_quantity desc
    limit 1
  `;
  const stockModifier: Modifier = stockModifierRow
    ? { type: stockModifierRow.modifier_type, value: Number(stockModifierRow.modifier_value) }
    : null;

  const result = calculateSuggestedPrice({
    baseAmount: Number(snapshot.amount),
    baseCurrency: snapshot.currency,
    targetCurrency: rule.target_currency,
    exchangeRate,
    marginType: rule.margin_type,
    marginValue: Number(rule.margin_value),
    conditionModifier,
    stockModifier,
  });

  const [calculatedPrice] = await sql<{ id: string }[]>`
    insert into calculated_prices (
      pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate,
      margin_amount, condition_modifier_amount, stock_modifier_amount, final_amount, currency
    ) values (
      ${pricingRuleId}, ${sellableSkuId}, ${result.baseAmount}, ${result.baseCurrency}, ${result.exchangeRate},
      ${result.marginAmount}, ${result.conditionModifierAmount}, ${result.stockModifierAmount}, ${result.finalAmount}, ${result.currency}
    )
    returning id
  `;

  await sql`
    insert into calculated_price_inputs (calculated_price_id, price_snapshot_id)
    values (${calculatedPrice.id}, ${snapshot.id})
  `;

  return { calculatedPriceId: calculatedPrice.id, result };
}
