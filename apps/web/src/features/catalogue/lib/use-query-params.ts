"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

function pushParams(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  params: URLSearchParams,
) {
  const query = params.toString();
  router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
}

// A single-value URL search param (e.g. ?sort=name-asc).
export function useQueryParam(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = searchParams.get(key) ?? "";

  function set(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set(key, next);
    } else {
      params.delete(key);
    }
    pushParams(router, pathname, params);
  }

  return { value, set };
}

// A comma-separated multi-value URL search param (e.g. ?rarities=common,rare),
// used for every checkbox-style filter group.
export function useQueryParamList(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = searchParams.get(key)?.split(",").filter(Boolean) ?? [];

  function toggle(value: string) {
    const next = values.includes(value)
      ? values.filter((existing) => existing !== value)
      : [...values, value];

    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) {
      params.set(key, next.join(","));
    } else {
      params.delete(key);
    }
    pushParams(router, pathname, params);
  }

  return { values, toggle };
}
