import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, ProjectStageEvent } from '../types/app'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setProjects(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { projects, loading, error, refresh }
}

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<Project | null>(null)
  const [events, setEvents] = useState<ProjectStageEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    const [projectRes, eventsRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase
        .from('project_stage_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
    ])
    if (projectRes.error) setError(projectRes.error.message)
    else setProject(projectRes.data)
    setEvents(eventsRes.data ?? [])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { project, events, loading, error, refresh }
}
