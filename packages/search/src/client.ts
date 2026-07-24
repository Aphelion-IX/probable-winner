import Typesense, { Client } from "typesense";

import { typesenseCollectionSchema } from "./typesense-schema";

export const CARDS_COLLECTION_NAME = typesenseCollectionSchema.name;

export type TypesenseClientOptions = {
  host?: string;
  port?: string;
  protocol?: string;
  apiKey?: string;
};

// Shared by the worker (reindex/incremental-update jobs) and the web app's
// search route handler — both need the exact same connection config and
// collection name, so this lives in the shared package rather than being
// duplicated in each app.
export function createTypesenseClient(options: TypesenseClientOptions = {}): Client {
  const host = options.host ?? process.env.TYPESENSE_HOST;
  const port = Number(options.port ?? process.env.TYPESENSE_PORT ?? 8108);
  const protocol = options.protocol ?? process.env.TYPESENSE_PROTOCOL ?? "http";
  const apiKey = options.apiKey ?? process.env.TYPESENSE_API_KEY;

  if (!host || !apiKey) {
    throw new Error("TYPESENSE_HOST and TYPESENSE_API_KEY must be set");
  }

  return new Typesense.Client({
    nodes: [{ host, port, protocol }],
    apiKey,
    connectionTimeoutSeconds: 5,
  });
}

// Idempotent: safe to call before every reindex or on worker startup.
// Typesense has no "create or replace collection" primitive, so this
// checks existence first rather than blindly creating (which would 409).
export async function ensureCardsCollectionExists(client: Client): Promise<void> {
  const exists = await client.collections(CARDS_COLLECTION_NAME).exists();
  if (!exists) {
    await client.collections().create(typesenseCollectionSchema);
  }
}
