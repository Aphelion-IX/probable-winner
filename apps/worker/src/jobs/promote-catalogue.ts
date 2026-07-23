import type { Sql } from "postgres";

import { mapIdentifiers, mapOracleCard, mapPrinting, mapSet } from "./catalogue-mapping.js";
import type { MtgJsonCard, MtgJsonSet } from "../integrations/mtgjson/types.js";

const GAME_CODE = "mtg";

export type PromoteRunResult = {
  setId: string;
  oracleCardsUpserted: number;
  printingsUpserted: number;
};

// Promotes validated staging rows for one import run into the live catalogue
// tables (backlog B-043). Every insert is an upsert keyed by the same
// unique constraints the schema already enforces (game+scryfall_oracle_id,
// set+collector_number, card_printing_id), so running this twice for the
// same run — or the same set re-imported in a later run — is a no-op the
// second time: zero duplicate rows, zero net row-count change.
export async function promoteRun(sql: Sql, runId: string): Promise<PromoteRunResult> {
  const [game] = await sql<{ id: string }[]>`select id from games where code = ${GAME_CODE}`;
  if (!game) {
    throw new Error(`Game "${GAME_CODE}" is not seeded — run the catalogue migrations first`);
  }

  const [stagedSet] = await sql<{ raw: Omit<MtgJsonSet, "cards"> }[]>`
    select raw from catalogue_staging_sets where catalogue_import_run_id = ${runId}
  `;
  if (!stagedSet) {
    throw new Error(`No staged set found for catalogue_import_run_id ${runId}`);
  }

  const stagedCards = await sql<{ raw: MtgJsonCard }[]>`
    select raw from catalogue_staging_cards where catalogue_import_run_id = ${runId}
  `;

  return sql.begin(async (sql) => {
    const setRow = mapSet(stagedSet.raw);
    const [set] = await sql<{ id: string }[]>`
      insert into sets (game_id, code, name, set_type, released_at, card_count)
      values (${game.id}, ${setRow.code}, ${setRow.name}, ${setRow.setType}, ${setRow.releasedAt}, ${setRow.cardCount})
      on conflict (game_id, code) do update set
        name = excluded.name,
        set_type = excluded.set_type,
        released_at = excluded.released_at,
        card_count = excluded.card_count
      returning id
    `;

    const oracleCardIds = new Map<string, string>();
    let printingsUpserted = 0;

    for (const { raw: card } of stagedCards) {
      const oracleRow = mapOracleCard(card);

      let oracleCardId = oracleCardIds.get(oracleRow.scryfallOracleId);
      if (!oracleCardId) {
        const [oracleCard] = await sql<{ id: string }[]>`
          insert into oracle_cards (
            game_id, scryfall_oracle_id, name, mana_cost, cmc, type_line,
            oracle_text, power, toughness, loyalty, colors, color_identity
          )
          values (
            ${game.id}, ${oracleRow.scryfallOracleId}, ${oracleRow.name}, ${oracleRow.manaCost},
            ${oracleRow.cmc}, ${oracleRow.typeLine}, ${oracleRow.oracleText}, ${oracleRow.power},
            ${oracleRow.toughness}, ${oracleRow.loyalty}, ${oracleRow.colors}, ${oracleRow.colorIdentity}
          )
          on conflict (game_id, scryfall_oracle_id) do update set
            name = excluded.name,
            mana_cost = excluded.mana_cost,
            cmc = excluded.cmc,
            type_line = excluded.type_line,
            oracle_text = excluded.oracle_text,
            power = excluded.power,
            toughness = excluded.toughness,
            loyalty = excluded.loyalty,
            colors = excluded.colors,
            color_identity = excluded.color_identity,
            updated_at = now()
          returning id
        `;
        oracleCardId = oracleCard.id;
        oracleCardIds.set(oracleRow.scryfallOracleId, oracleCardId);
      }

      const printingRow = mapPrinting(card);
      let artistId: string | null = null;
      if (printingRow.artistName) {
        const [artist] = await sql<{ id: string }[]>`
          insert into artists (name) values (${printingRow.artistName})
          on conflict (name) do update set name = excluded.name
          returning id
        `;
        artistId = artist.id;
      }

      const [printing] = await sql<{ id: string }[]>`
        insert into card_printings (
          oracle_card_id, set_id, artist_id, collector_number, rarity, finishes,
          frame, border_color, flavor_text, is_promo, is_variation, released_at
        )
        values (
          ${oracleCardId}, ${set.id}, ${artistId}, ${printingRow.collectorNumber}, ${printingRow.rarity},
          ${printingRow.finishes}, ${printingRow.frame}, ${printingRow.borderColor}, ${printingRow.flavorText},
          ${printingRow.isPromo}, ${printingRow.isVariation}, ${setRow.releasedAt}
        )
        on conflict (set_id, collector_number) do update set
          oracle_card_id = excluded.oracle_card_id,
          artist_id = excluded.artist_id,
          rarity = excluded.rarity,
          finishes = excluded.finishes,
          frame = excluded.frame,
          border_color = excluded.border_color,
          flavor_text = excluded.flavor_text,
          is_promo = excluded.is_promo,
          is_variation = excluded.is_variation,
          updated_at = now()
        returning id
      `;
      printingsUpserted += 1;

      const idRow = mapIdentifiers(card);
      await sql`
        insert into card_identifiers (
          card_printing_id, mtgjson_uuid, scryfall_id, tcgplayer_product_id, cardmarket_id, multiverse_ids
        )
        values (
          ${printing.id}, ${idRow.mtgjsonUuid}, ${idRow.scryfallId}, ${idRow.tcgplayerProductId},
          ${idRow.cardmarketId}, ${idRow.multiverseIds}
        )
        on conflict (card_printing_id) do update set
          mtgjson_uuid = excluded.mtgjson_uuid,
          scryfall_id = excluded.scryfall_id,
          tcgplayer_product_id = excluded.tcgplayer_product_id,
          cardmarket_id = excluded.cardmarket_id,
          multiverse_ids = excluded.multiverse_ids
      `;
    }

    return {
      setId: set.id,
      oracleCardsUpserted: oracleCardIds.size,
      printingsUpserted,
    };
  });
}
