import { useParams } from 'react-router-dom'
import { useProject } from '../hooks/useProjects'
import { emptyEstimate } from '../types/app'
import { isEstimateData } from '../lib/estimate'
import { StageBadge, ReviewStatusBadge } from '../components/ui/Badge'
import { EstimateSummary } from '../components/estimate/EstimateSummary'
import { Button } from '../components/ui/Button'
import { formatDateTime } from '../lib/format'

export function ClientSummaryPage() {
  const { id } = useParams<{ id: string }>()
  const { project, loading, error } = useProject(id)

  if (loading) return <p className="p-6 text-sm text-steel-500">Loading…</p>
  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>
  if (!project) return <p className="p-6 text-sm text-steel-500">Project not found.</p>

  const estimate = isEstimateData(project.data) ? project.data : emptyEstimate()

  return (
    <div className="min-h-svh bg-steel-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-steel-200 bg-white px-4 py-3">
        <span className="text-sm text-steel-500">Client-ready summary</span>
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
        <div className="rounded-2xl bg-white p-6 shadow-sm print:rounded-none print:shadow-none sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-steel-200 pb-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
                  SP
                </div>
                <span className="font-semibold text-steel-900">SpeedPanel</span>
              </div>
              <h1 className="mt-4 text-lg font-semibold text-steel-900">{project.name}</h1>
              <p className="text-sm text-steel-500">Generated {formatDateTime(new Date().toISOString())}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StageBadge stage={project.stage} />
              {project.stage === 'install_review' && <ReviewStatusBadge status={project.install_review_status} />}
              {project.stage === 'technical_review' && <ReviewStatusBadge status={project.technical_review_status} />}
            </div>
          </div>

          <EstimateSummary estimate={estimate} />

          <p className="mt-8 text-xs text-steel-400">
            This summary reflects the estimate on file as of the date above and is subject to final technical review.
          </p>
        </div>
      </div>
    </div>
  )
}
