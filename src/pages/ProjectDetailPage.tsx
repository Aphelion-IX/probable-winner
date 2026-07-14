import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useHasPermission } from '../hooks/usePermission'
import { useProject } from '../hooks/useProjects'
import { supabase } from '../lib/supabase'
import { emptyEstimate } from '../types/app'
import { isEstimateData } from '../lib/estimate'
import { StageBadge, ReviewStatusBadge } from '../components/ui/Badge'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Textarea } from '../components/ui/Field'
import { EstimateSummary } from '../components/estimate/EstimateSummary'
import { ProjectTimeline } from '../components/ProjectTimeline'
import { ProjectDocuments } from '../components/ProjectDocuments'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const { project, events, loading, error, refresh } = useProject(id)
  const { allowed: canReviewInstall } = useHasPermission('project_reviews.review_install')
  const { allowed: canReviewTechnical } = useHasPermission('project_reviews.review_technical')

  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <p className="text-sm text-steel-500">Loading project…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!project) return <p className="text-sm text-steel-500">Project not found.</p>

  const estimate = isEstimateData(project.data) ? project.data : emptyEstimate()
  const isOwner = project.owner_id === session?.user.id
  const canEdit = isOwner || canReviewInstall || canReviewTechnical

  async function runAction(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) setActionError(error.message)
    else {
      setNote('')
      await refresh()
    }
  }

  const requestInstallReview = () =>
    runAction(() => supabase.rpc('request_install_review', { p_project_id: project.id }))
  const requestTechnicalReview = () =>
    runAction(() => supabase.rpc('request_technical_review', { p_project_id: project.id }))
  const reviewInstall = (decision: 'approved' | 'changes_requested') =>
    runAction(() => supabase.rpc('review_install', { p_project_id: project.id, p_decision: decision, p_note: note || undefined }))
  const reviewTechnical = (decision: 'approved' | 'changes_requested') =>
    runAction(() => supabase.rpc('review_technical', { p_project_id: project.id, p_decision: decision, p_note: note || undefined }))

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-steel-900">{project.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StageBadge stage={project.stage} />
            {project.stage === 'install_review' && <ReviewStatusBadge status={project.install_review_status} />}
            {project.stage === 'technical_review' && <ReviewStatusBadge status={project.technical_review_status} />}
          </div>
        </div>
        <Link to={`/projects/${project.id}/summary`} target="_blank">
          <Button variant="secondary">Send to client</Button>
        </Link>
      </div>

      {(project.install_review_note || project.technical_review_note) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardBody>
            {project.install_review_note && (
              <p className="text-sm text-amber-800">
                <span className="font-medium">Install review note:</span> {project.install_review_note}
              </p>
            )}
            {project.technical_review_note && (
              <p className="mt-1 text-sm text-amber-800">
                <span className="font-medium">Technical review note:</span> {project.technical_review_note}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-steel-700">Estimate</h2>
        <EstimateSummary estimate={estimate} />
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-steel-700">Actions</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

          {project.stage === 'draft' && isOwner && (
            <Button onClick={requestInstallReview} loading={busy}>
              Request install review
            </Button>
          )}

          {project.stage === 'draft' && project.install_review_status === 'approved' && isOwner && (
            <Button onClick={requestTechnicalReview} loading={busy}>
              Request technical review
            </Button>
          )}

          {project.stage === 'install_review' && canReviewInstall && (
            <div className="space-y-2">
              <Textarea placeholder="Review note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => reviewInstall('approved')} loading={busy}>
                  Approve install
                </Button>
                <Button variant="danger" onClick={() => reviewInstall('changes_requested')} loading={busy}>
                  Request changes
                </Button>
              </div>
            </div>
          )}

          {project.stage === 'technical_review' && canReviewTechnical && (
            <div className="space-y-2">
              <Textarea placeholder="Review note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button onClick={() => reviewTechnical('approved')} loading={busy}>
                  Approve technical review
                </Button>
                <Button variant="danger" onClick={() => reviewTechnical('changes_requested')} loading={busy}>
                  Request changes
                </Button>
              </div>
            </div>
          )}

          {!(
            (project.stage === 'draft' && isOwner) ||
            (project.stage === 'install_review' && canReviewInstall) ||
            (project.stage === 'technical_review' && canReviewTechnical)
          ) && <p className="text-sm text-steel-500">No actions available at this stage.</p>}
        </CardBody>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-steel-700">Site photos & documents</h2>
        <ProjectDocuments projectId={project.id} canUpload={canEdit} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-steel-700">Activity</h2>
        <ProjectTimeline events={events} />
      </section>
    </div>
  )
}
