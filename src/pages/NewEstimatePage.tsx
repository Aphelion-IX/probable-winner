import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMyCompanies } from '../hooks/useCompanies'
import { supabase } from '../lib/supabase'
import { emptyEstimate } from '../types/app'
import type { EstimateLineItem } from '../types/app'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { FieldWrapper, Input, Textarea } from '../components/ui/Field'
import { Button } from '../components/ui/Button'
import { LineItemEditor } from '../components/estimate/LineItemEditor'

export function NewEstimatePage() {
  const { session } = useAuth()
  const { companies, loading: companiesLoading } = useMyCompanies()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState<string>('')
  const [address, setAddress] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session?.user) return
    setSaving(true)
    setError(null)

    const estimate = {
      ...emptyEstimate(),
      site: { address, contactName, contactPhone, notes },
      lineItems,
      updatedAt: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: name || 'Untitled project',
        owner_id: session.user.id,
        company_id: companyId || null,
        data: estimate,
      })
      .select('id')
      .single()

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(`/projects/${data.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-6">
      <div>
        <h1 className="text-xl font-semibold text-steel-900">New site estimate</h1>
        <p className="text-sm text-steel-500">Capture the site details and build up the material list.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-steel-700">Project & site</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <FieldWrapper label="Project name" htmlFor="name">
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 42 Industrial Ave — Cool Room" />
          </FieldWrapper>

          {!companiesLoading && companies.length > 0 && (
            <FieldWrapper label="Company (optional)" htmlFor="company">
              <select
                id="company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full rounded-lg border border-steel-300 bg-white px-3 py-2.5 text-base text-steel-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">Personal project</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.trading_name || c.legal_name}
                  </option>
                ))}
              </select>
            </FieldWrapper>
          )}

          <FieldWrapper label="Site address" htmlFor="address">
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state" />
          </FieldWrapper>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldWrapper label="Site contact name" htmlFor="contactName">
              <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </FieldWrapper>
            <FieldWrapper label="Site contact phone" htmlFor="contactPhone">
              <Input id="contactPhone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </FieldWrapper>
          </div>

          <FieldWrapper label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FieldWrapper>
        </CardBody>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-steel-700">Materials</h2>
        <LineItemEditor companyId={companyId || null} lineItems={lineItems} gstRate={0.1} onChange={setLineItems} />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button type="submit" loading={saving}>
          Save estimate
        </Button>
      </div>
    </form>
  )
}
