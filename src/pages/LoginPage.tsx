import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { FieldWrapper, Input } from '../components/ui/Field'

export function LoginPage() {
  const { session, signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signInWithPassword(email, password)
    setSubmitting(false)
    if (error) setError(error)
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-steel-950 px-4 py-10">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-lg font-bold text-white">
          SP
        </div>
        <div>
          <div className="text-lg font-semibold text-white">SpeedPanel</div>
          <div className="text-xs text-steel-400">Site Estimator</div>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-semibold text-steel-900">Sign in</h1>
        <p className="mt-1 text-sm text-steel-500">Estimate jobs and manage install reviews on site.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <FieldWrapper label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FieldWrapper>
          <FieldWrapper label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FieldWrapper>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" loading={submitting}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  )
}
