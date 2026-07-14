import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { AppShell } from './AppShell'

export function ProtectedRoute({ children, shell = true }: { children: ReactNode; shell?: boolean }) {
  const { session, loading } = useAuth()

  if (!session) return <Navigate to="/login" replace />

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-steel-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  return shell ? <AppShell>{children}</AppShell> : <>{children}</>
}
