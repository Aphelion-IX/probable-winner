const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' })

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return currencyFormatter.format(value)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return dateFormatter.format(new Date(value))
}
