import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Fixing, Panel, Sealant, Track } from '../types/app'

export type Catalog = {
  panels: Panel[]
  tracks: Track[]
  fixings: Fixing[]
  sealants: Sealant[]
}

const emptyCatalog: Catalog = { panels: [], tracks: [], fixings: [], sealants: [] }

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.all([
      supabase.from('panels').select('*').order('label'),
      supabase.from('tracks').select('*').order('label'),
      supabase.from('fixings').select('*').order('code'),
      supabase.from('sealants').select('*').order('product'),
    ]).then(([panels, tracks, fixings, sealants]) => {
      if (!active) return
      const firstError = panels.error ?? tracks.error ?? fixings.error ?? sealants.error
      if (firstError) {
        setError(firstError.message)
      } else {
        setCatalog({
          panels: panels.data ?? [],
          tracks: tracks.data ?? [],
          fixings: fixings.data ?? [],
          sealants: sealants.data ?? [],
        })
      }
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  return { catalog, loading, error }
}
