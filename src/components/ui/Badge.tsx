type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-steel-100 text-steel-700',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}

const stageTone: Record<string, Tone> = {
  draft: 'neutral',
  install_review: 'warning',
  technical_review: 'brand',
  approved: 'success',
}

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={stageTone[stage] ?? 'neutral'}>{stage.replace('_', ' ')}</Badge>
}

const statusTone: Record<string, Tone> = {
  pending: 'warning',
  approved: 'success',
  changes_requested: 'danger',
}

export function ReviewStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return <Badge tone={statusTone[status] ?? 'neutral'}>{status.replace('_', ' ')}</Badge>
}
