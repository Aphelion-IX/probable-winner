import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useHasPermission } from '../hooks/usePermission'
import { useProjects } from '../hooks/useProjects'
import { ProjectCard } from '../components/ProjectCard'
import { EmptyState } from '../components/ui/EmptyState'
import { Button } from '../components/ui/Button'

export function DashboardPage() {
  const { profile } = useAuth()
  const { allowed: canReviewInstalls } = useHasPermission('project_reviews.review_install')
  const { projects, loading } = useProjects()

  const pendingInstallReviews = projects.filter(
    (p) => p.stage === 'install_review' && p.install_review_status === 'pending',
  )
  const myProjects = projects.filter((p) => !pendingInstallReviews.includes(p))

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-steel-900">
            {profile?.display_name ? `Hi, ${profile.display_name.split(' ')[0]}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-steel-500">Build estimates and manage on-site install reviews.</p>
        </div>
        <Link to="/projects/new" className="hidden sm:block">
          <Button>New estimate</Button>
        </Link>
      </div>

      {canReviewInstalls && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-steel-500">
            Awaiting your install review
          </h2>
          {pendingInstallReviews.length === 0 && !loading ? (
            <EmptyState title="Nothing waiting on you" description="Install review requests will show up here." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pendingInstallReviews.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-steel-500">Projects</h2>
        {loading ? (
          <p className="text-sm text-steel-500">Loading projects…</p>
        ) : myProjects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Start a new on-site estimate to create your first project."
            action={
              <Link to="/projects/new">
                <Button>New estimate</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
