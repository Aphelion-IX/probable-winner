import { computeTotals } from '../../lib/estimate'
import { formatCurrency } from '../../lib/format'
import type { EstimateData } from '../../types/app'

export function EstimateSummary({ estimate }: { estimate: EstimateData }) {
  const totals = computeTotals(estimate)
  const { site } = estimate

  return (
    <div className="space-y-4">
      {(site.address || site.contactName || site.contactPhone || site.notes) && (
        <div className="grid gap-x-6 gap-y-2 rounded-xl border border-steel-200 bg-white p-4 text-sm sm:grid-cols-2">
          {site.address && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-steel-400">Site address</div>
              <div className="text-steel-800">{site.address}</div>
            </div>
          )}
          {(site.contactName || site.contactPhone) && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-steel-400">Site contact</div>
              <div className="text-steel-800">
                {site.contactName}
                {site.contactName && site.contactPhone && ' · '}
                {site.contactPhone}
              </div>
            </div>
          )}
          {site.notes && (
            <div className="sm:col-span-2">
              <div className="text-xs font-medium uppercase tracking-wide text-steel-400">Notes</div>
              <div className="whitespace-pre-wrap text-steel-800">{site.notes}</div>
            </div>
          )}
        </div>
      )}

      {estimate.lineItems.length === 0 ? (
        <p className="text-sm text-steel-500">No materials added yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-steel-50 text-left text-xs font-medium uppercase tracking-wide text-steel-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit price</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-200">
              {estimate.lineItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-steel-800">{item.label}</td>
                  <td className="px-4 py-2 text-right text-steel-600">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-4 py-2 text-right text-steel-600">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-4 py-2 text-right font-medium text-steel-800">{formatCurrency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 border-t border-steel-200 bg-steel-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-steel-600">
              <span>Subtotal (ex GST)</span>
              <span>{formatCurrency(totals.subtotalExGst)}</span>
            </div>
            <div className="flex justify-between text-steel-600">
              <span>GST ({Math.round(estimate.gstRate * 100)}%)</span>
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
