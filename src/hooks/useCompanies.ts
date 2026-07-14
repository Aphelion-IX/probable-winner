import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { Company } from '../types/app'

export function useMyCompanies() {
  const { session } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user) {
      setCompanies([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    supabase
      .from('company_memberships')
      .select('status, companies(*)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setCompanies([])
        } else {
          setCompanies((data ?? []).map((row) => row.companies).filter((c): c is Company => Boolean(c)))
        }
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [session?.user])

  return { companies, loading }
}
