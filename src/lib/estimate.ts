import type { EstimateData } from '../types/app'

export function computeTotals(estimate: EstimateData) {
  const subtotalExGst = estimate.lineItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)
  const gstAmount = subtotalExGst * estimate.gstRate
  const totalIncGst = subtotalExGst + gstAmount
  return { subtotalExGst, gstAmount, totalIncGst }
}

export function isEstimateData(value: unknown): value is EstimateData {
  return Boolean(value) && typeof value === 'object' && 'lineItems' in (value as object)
}
