// Calls the live worker's own admin HTTP endpoints (see http-server.ts) --
// used by the standalone reindex-search/update-popularity-scores scripts,
// which run as separate short-lived processes and would otherwise mutate an
// index in their own throwaway memory that the actual running worker never
// sees.
export async function callAdminEndpoint<T>(path: string): Promise<T> {
  const baseUrl = process.env.SEARCH_SERVICE_URL;
  const token = process.env.SEARCH_SERVICE_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("SEARCH_SERVICE_URL and SEARCH_SERVICE_TOKEN must be set");
  }

  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "x-search-service-token": token },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} returned ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}
