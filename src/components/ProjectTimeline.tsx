import { formatDateTime } from '../lib/format'
import type { ProjectStageEvent } from '../types/app'

const eventLabels: Record<string, string> = {
  install_review_requested: 'Install review requested',
  install_review_approved: 'Install review approved',
  install_review_changes_requested: 'Install review — changes requested',
  technical_review_requested: 'Technical review requested',
  technical_review_approved: 'Technical review approved',
  technical_review_changes_requested: 'Technical review — changes requested',
}

export function ProjectTimeline({ events }: { events: ProjectStageEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-steel-500">No activity yet.</p>

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
          <div>
            <p className="font-medium text-steel-800">{eventLabels[event.event_type] ?? event.event_type}</p>
            {event.note && <p className="mt-0.5 text-steel-600">{event.note}</p>}
            <p className="mt-0.5 text-xs text-steel-400">{formatDateTime(event.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
