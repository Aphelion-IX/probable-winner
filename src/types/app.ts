import type { Database } from './database.types'

export type Tables = Database['public']['Tables']
export type Profile = Tables['profiles']['Row']
export type Project = Tables['projects']['Row']
export type ProjectStageEvent = Tables['project_stage_events']['Row']
export type ProjectDocument = Tables['project_documents']['Row']
export type Company = Tables['companies']['Row']
export type CompanyMembership = Tables['company_memberships']['Row']
export type Panel = Tables['panels']['Row']
export type Track = Tables['tracks']['Row']
export type Fixing = Tables['fixings']['Row']
export type Sealant = Tables['sealants']['Row']
export type Colour = Tables['colours']['Row']

export type CatalogCategory = 'panel' | 'track' | 'fixing' | 'sealant'

export type EstimateLineItem = {
  id: string
  category: CatalogCategory
  productId: string
  label: string
  unit: string
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
}

export type EstimateSite = {
  address: string
  contactName: string
  contactPhone: string
  notes: string
}

export type EstimateData = {
  site: EstimateSite
  lineItems: EstimateLineItem[]
  gstRate: number
  updatedAt: string
}

export const emptyEstimate = (): EstimateData => ({
  site: { address: '', contactName: '', contactPhone: '', notes: '' },
  lineItems: [],
  gstRate: 0.1,
  updatedAt: new Date().toISOString(),
})
