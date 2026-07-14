import type { Catalog } from '../hooks/useCatalog'
import type { CatalogCategory } from '../types/app'

export type CatalogOption = {
  id: string
  label: string
  unit: string
  basePrice: number | null
}

export function catalogOptions(catalog: Catalog, category: CatalogCategory): CatalogOption[] {
  switch (category) {
    case 'panel':
      return catalog.panels.map((p) => ({
        id: p.id,
        label: `${p.label} · ${p.depth} · FRL ${p.frl}`,
        unit: 'panel',
        basePrice: p.price_per_panel,
      }))
    case 'track':
      return catalog.tracks.map((t) => ({
        id: t.id,
        label: `${t.label} · ${t.dim}`,
        unit: 'm',
        basePrice: t.price_per_metre,
      }))
    case 'fixing':
      return catalog.fixings.map((f) => ({
        id: f.id,
        label: `${f.code} · ${f.gauge} · ${f.length_mm}mm`,
        unit: 'box',
        basePrice: f.price_per_box,
      }))
    case 'sealant':
      return catalog.sealants.map((s) => ({
        id: s.id,
        label: `${s.product} · ${s.system}`,
        unit: 'box',
        basePrice: s.price_per_box,
      }))
  }
}

export const categoryLabels: Record<CatalogCategory, string> = {
  panel: 'Panels',
  track: 'Tracks',
  fixing: 'Fixings',
  sealant: 'Sealants',
}
