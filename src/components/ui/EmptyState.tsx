import type { ReactNode } from 'react'

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-steel-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-steel-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-steel-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
