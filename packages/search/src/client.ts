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
//
// If the collection already exists, its live schema can still be missing
// fields that were added to typesenseCollectionSchema after the collection
// was first created -- Typesense never reconciles this on its own, and nor
// did this function until now. Confirmed live in production: `catalogued_at`
// (added for the "recently added" feed, B-193) was in the schema here but
// not on the actual collection, so every /recently-added search 404'd with
// "Could not find a field named `catalogued_at` in the schema for sorting."
// image_url hit the exact same gap earlier and was worked around by hand
// (manually deleting and recreating the collection) -- this closes the bug
// class instead of re-fixing it field by field. Missing fields are added via
// Typesense's collection update API rather than delete+recreate, so search
// keeps working through the change, and are marked optional since documents
// already indexed before this call genuinely lack a value for them.
export async function ensureCardsCollectionExists(client: Client): Promise<void> {
  const exists = await client.collections(CARDS_COLLECTION_NAME).exists();
  if (!exists) {
    await client.collections().create(typesenseCollectionSchema);
    return;
  }

  const current = await client.collections(CARDS_COLLECTION_NAME).retrieve();
  const existingFieldNames = new Set(current.fields.map((field) => field.name));
  const missingFields = (typesenseCollectionSchema.fields ?? []).filter(
    // Typesense manages `id` internally and never returns it from retrieve()
    // -- confirmed live: including it here gets "Field `id` cannot be
    // altered" back from the update API, since Typesense special-cases it
    // and refuses to let it be touched at all.
    (field) => field.name !== "id" && !existingFieldNames.has(field.name),
  );

  if (missingFields.length > 0) {
    await client.collections(CARDS_COLLECTION_NAME).update({
      fields: missingFields.map((field) => ({ ...field, optional: true })),
    });
  }
}
