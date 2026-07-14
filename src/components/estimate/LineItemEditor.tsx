import { useMemo, useState } from 'react'
import { useCatalog } from '../../hooks/useCatalog'
import { useCompanyPricing } from '../../hooks/usePricing'
import { catalogOptions, categoryLabels } from '../../lib/catalogLabels'
import { computeTotals } from '../../lib/estimate'
import { formatCurrency } from '../../lib/format'
import type { CatalogCategory, EstimateLineItem } from '../../types/app'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'

const categories: CatalogCategory[] = ['panel', 'track', 'fixing', 'sealant']

type Props = {
  companyId: string | null
  lineItems: EstimateLineItem[]
  gstRate: number
  onChange: (lineItems: EstimateLineItem[]) => void
}

export function LineItemEditor({ companyId, lineItems, gstRate, onChange }: Props) {
  const { catalog, loading: catalogLoading } = useCatalog()
  const { getPrice, loading: pricingLoading } = useCompanyPricing(companyId)
  const [category, setCategory] = useState<CatalogCategory>('panel')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')

  const options = useMemo(() => catalogOptions(catalog, category), [catalog, category])
  const selected = options.find((o) => o.id === productId)

  function addItem() {
    if (!selected) return
    const qty = Number(quantity) || 0
    if (qty <= 0) return
    const unitPrice = getPrice(category, selected.id, selected.basePrice)
    const item: EstimateLineItem = {
      id: crypto.randomUUID(),
      category,
      productId: selected.id,
      label: selected.label,
      unit: selected.unit,
      quantity: qty,
      unitPrice,
      lineTotal: unitPrice !== null ? unitPrice * qty : null,
    }
    onChange([...lineItems, item])
    setProductId('')
    setQuantity('1')
  }

  function removeItem(id: string) {
    onChange(lineItems.filter((i) => i.id !== id))
  }

  const totals = computeTotals({ lineItems, gstRate, site: { address: '', contactName: '', contactPhone: '', notes: '' }, updatedAt: '' })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-steel-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c)
                setProductId('')
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                category === c ? 'bg-brand-600 text-white' : 'bg-steel-100 text-steel-600 hover:bg-steel-200'
              }`}
            >
              {categoryLabels[c]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full flex-1 rounded-lg border border-steel-300 bg-white px-3 py-2.5 text-base text-steel-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">{catalogLoading ? 'Loading catalog…' : `Select a ${category}`}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Input
            type="number"
            min="0"
            step="0.1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="sm:w-28"
            aria-label="Quantity"
          />
          <Button type="button" onClick={addItem} disabled={!selected} className="shrink-0">
            Add
          </Button>
        </div>
        {selected && (
          <p className="mt-2 text-xs text-steel-500">
            {pricingLoading
              ? 'Resolving price…'
              : selected.basePrice === null && getPrice(category, selected.id, selected.basePrice) === null
                ? 'No price set for this item yet — it will show as unpriced.'
                : `${formatCurrency(getPrice(category, selected.id, selected.basePrice))} per ${selected.unit}`}
          </p>
        )}
      </div>

      {lineItems.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white">
          <ul className="divide-y divide-steel-200">
            {lineItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-steel-800">{item.label}</p>
                  <p className="text-xs text-steel-500">
                    {item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-steel-800">{formatCurrency(item.lineTotal)}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.label}`}
                    className="text-steel-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-steel-200 bg-steel-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-steel-600">
              <span>Subtotal (ex GST)</span>
              <span>{formatCurrency(totals.subtotalExGst)}</span>
            </div>
            <div className="flex justify-between text-steel-600">
              <span>GST ({Math.round(gstRate * 100)}%)</span>
              <span>{formatCurrency(totals.gstAmount)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-steel-900">
              <span>Total (inc GST)</span>
              <span>{formatCurrency(totals.totalIncGst)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
