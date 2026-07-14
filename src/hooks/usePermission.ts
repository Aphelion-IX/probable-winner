import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

/** Mirrors the server-side has_permission() check so review actions can be shown/hidden. */
export function useHasPermission(permissionKey: string) {
  const { session, isStaff } = useAuth()
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user || !isStaff) {
      setAllowed(false)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    supabase
      .rpc('has_permission', { p_permission_key: permissionKey })
      .then(({ data, error }) => {
        if (!active) return
        setAllowed(Boolean(data) && !error)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [session?.user, isStaff, permissionKey])

  return { allowed, loading }
}
