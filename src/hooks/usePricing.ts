import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CatalogCategory } from '../types/app'

type PriceMap = Map<string, number>

function key(category: CatalogCategory, productId: string) {
  return `${category}:${productId}`
}

const productColumn: Record<CatalogCategory, string> = {
  panel: 'panel_id',
  track: 'track_id',
  fixing: 'fixing_id',
  sealant: 'sealant_id',
}

/** Resolves per-unit pricing for a company: company overrides > assigned/default price list > base catalog price. */
export function useCompanyPricing(companyId: string | null) {
  const [overrides, setOverrides] = useState<PriceMap>(new Map())
  const [priceList, setPriceList] = useState<PriceMap>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    async function load() {
      const nextOverrides: PriceMap = new Map()
      const nextPriceList: PriceMap = new Map()

      let priceListId: string | null = null

      if (companyId) {
        const [{ data: company }, { data: overrideRows }] = await Promise.all([
          supabase.from('companies').select('price_list_id').eq('id', companyId).maybeSingle(),
          supabase.from('company_product_overrides').select('*').eq('company_id', companyId),
        ])
        priceListId = company?.price_list_id ?? null
        for (const row of overrideRows ?? []) {
          for (const category of Object.keys(productColumn) as CatalogCategory[]) {
            const productId = row[productColumn[category] as keyof typeof row] as string | null
            if (productId && row.price !== null) nextOverrides.set(key(category, productId), Number(row.price))
          }
        }
      }

      if (!priceListId) {
        const { data: defaultList } = await supabase.from('price_lists').select('id').eq('is_default', true).maybeSingle()
        priceListId = defaultList?.id ?? null
      }

      if (priceListId) {
        const { data: priceRows } = await supabase.from('price_list_prices').select('*').eq('price_list_id', priceListId)
        for (const row of priceRows ?? []) {
          const category = row.category as CatalogCategory
          const productId = row[productColumn[category] as keyof typeof row] as string | null
          if (productId) nextPriceList.set(key(category, productId), Number(row.price))
        }
      }

      if (!active) return
      setOverrides(nextOverrides)
      setPriceList(nextPriceList)
      setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
  }, [companyId])

  function getPrice(category: CatalogCategory, productId: string, basePrice: number | null): number | null {
    const overrideKey = key(category, productId)
    if (overrides.has(overrideKey)) return overrides.get(overrideKey)!
    if (priceList.has(overrideKey)) return priceList.get(overrideKey)!
    return basePrice
  }

  return { getPrice, loading }
}
