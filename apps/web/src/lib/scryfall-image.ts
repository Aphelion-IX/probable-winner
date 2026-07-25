// Scryfall image URLs must go through /api/scryfall-image rather than
// being passed straight to next/image -- see that route for why (Scryfall
// rejects the generic User-Agent Next's built-in image optimizer sends).
// The URL is a path segment rather than a query param -- see the route's
// comment on why a query param can't be allow-listed in localPatterns.
export function scryfallImageProxyUrl(url: string): string {
  return `/api/scryfall-image/${encodeURIComponent(url)}`;
}
