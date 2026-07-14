import { Link } from 'react-router-dom'
import { Card, CardBody } from './ui/Card'
import { StageBadge, ReviewStatusBadge } from './ui/Badge'
import { formatDateTime } from '../lib/format'
import type { Project } from '../types/app'
import { isEstimateData } from '../lib/estimate'

export function ProjectCard({ project }: { project: Project }) {
  const estimate = isEstimateData(project.data) ? project.data : null
  const address = estimate?.site?.address

  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardBody>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-medium text-steel-900">{project.name || 'Untitled project'}</h3>
              {address && <p className="mt-0.5 truncate text-sm text-steel-500">{address}</p>}
            </div>
            <StageBadge stage={project.stage} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {project.stage === 'install_review' && <ReviewStatusBadge status={project.install_review_status} />}
            {project.stage === 'technical_review' && <ReviewStatusBadge status={project.technical_review_status} />}
            <span className="text-xs text-steel-400">Updated {formatDateTime(project.updated_at)}</span>
          </div>
        </CardBody>
      </Card>
    </Link>
  )
}
