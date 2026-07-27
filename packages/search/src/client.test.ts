import { describe, expect, it, vi } from "vitest";

import { ensureCardsCollectionExists, CARDS_COLLECTION_NAME } from "./client";
import { typesenseCollectionSchema } from "./typesense-schema";

function fakeClient(overrides: {
  exists: boolean;
  currentFields?: { name: string; type: string }[];
}) {
  const create = vi.fn().mockResolvedValue({});
  const retrieve = vi.fn().mockResolvedValue({ fields: overrides.currentFields ?? [] });
  const update = vi.fn().mockResolvedValue({});
  const exists = vi.fn().mockResolvedValue(overrides.exists);

  const client = {
    collections: (name?: string) => {
      if (name === undefined) {
        return { create };
      }
      expect(name).toBe(CARDS_COLLECTION_NAME);
      return { exists, retrieve, update };
    },
  };

  return { client, create, retrieve, update, exists };
}

describe("ensureCardsCollectionExists", () => {
  it("creates the collection from scratch when it doesn't exist yet", async () => {
    const { client, create, retrieve, update } = fakeClient({ exists: false });

    await ensureCardsCollectionExists(client as never);

    expect(create).toHaveBeenCalledWith(typesenseCollectionSchema);
    expect(retrieve).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing when an existing collection already has every schema field", async () => {
    const { client, create, update } = fakeClient({
      exists: true,
      currentFields: typesenseCollectionSchema.fields!.map((f) => ({ name: f.name, type: f.type })),
    });

    await ensureCardsCollectionExists(client as never);

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("adds only the missing fields to an existing collection, marked optional", async () => {
    // Regression test: a real production incident where `catalogued_at` was
    // added to typesenseCollectionSchema (for the "recently added" feed) but
    // the live collection, created before that change, never picked it up --
    // every /recently-added search 404'd with "Could not find a field named
    // `catalogued_at` in the schema for sorting."
    const allButCataloguedAt = typesenseCollectionSchema
      .fields!.filter((f) => f.name !== "catalogued_at")
      .map((f) => ({ name: f.name, type: f.type }));
    const { client, create, update } = fakeClient({ exists: true, currentFields: allButCataloguedAt });

    await ensureCardsCollectionExists(client as never);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      fields: [{ name: "catalogued_at", type: "int64", facet: false, optional: true }],
    });
  });

  it("never tries to alter the `id` field, even though it's absent from a retrieved schema", async () => {
    // Typesense manages `id` internally and never returns it from
    // retrieve() -- confirmed live: including it in an update call gets
    // rejected outright with "Field `id` cannot be altered."
    const withoutId = typesenseCollectionSchema
      .fields!.filter((f) => f.name !== "id")
      .map((f) => ({ name: f.name, type: f.type }));
    const { client, update } = fakeClient({ exists: true, currentFields: withoutId });

    await ensureCardsCollectionExists(client as never);

    expect(update).not.toHaveBeenCalled();
  });
});
