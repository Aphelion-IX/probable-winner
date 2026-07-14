import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { ProjectDocument } from '../types/app'
import { Button } from './ui/Button'

const BUCKET = 'project-documents'

export function ProjectDocuments({ projectId, canUpload }: { projectId: string; canUpload: boolean }) {
  const { session } = useAuth()
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [links, setLinks] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const { data } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    setDocuments(data ?? [])

    const nextLinks: Record<string, string> = {}
    for (const doc of data ?? []) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60 * 60)
      if (signed?.signedUrl) nextLinks[doc.id] = signed.signedUrl
    }
    setLinks(nextLinks)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !session?.user) return
    setUploading(true)
    setError(null)

    const storagePath = `${projectId}/${crypto.randomUUID()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file)
    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
      return
    }

    const { error: insertError } = await supabase.from('project_documents').insert({
      project_id: projectId,
      uploaded_by: session.user.id,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
    })
    if (insertError) setError(insertError.message)

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    await refresh()
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-sm text-steel-500">No photos or documents attached yet.</p>
      ) : (
        <ul className="divide-y divide-steel-200 rounded-xl border border-steel-200 bg-white">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate text-steel-800">{doc.file_name}</span>
              {links[doc.id] && (
                <a href={links[doc.id]} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-brand-600 hover:underline">
                  View
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div>
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
          <Button type="button" variant="secondary" loading={uploading} onClick={() => fileInputRef.current?.click()}>
            Add photo / document
          </Button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
