-- Demo/showcase catalogue seed. The live catalogue import pipeline
-- (import_set_and_promote(), backlog B-040-B-046) has never been run
-- against this project -- oracle_cards/card_printings/sellable_skus are
-- all empty -- so the storefront has nothing real to search, browse, or
-- add to cart. This seeds a small, recognisable set of real Magic: The
-- Gathering cards (name/mana cost/type/rarity are accurate; the printing
-- itself is a single demo set, not a claim about which real set each card
-- was reprinted in) with real pricing and real stock across all four
-- stores, so the storefront demonstrates genuinely working search,
-- browse, availability, and checkout rather than the hardcoded sample
-- cards on the homepage.
--
-- Inventory is seeded by inserting inventory_movements + updating
-- inventory_balances directly (the same effect receive_inventory()
-- produces) rather than calling receive_inventory() itself, since that
-- function's staff_has_node_access() check requires an authenticated
-- staff auth.uid() that doesn't exist in a migration's execution context.

do $$
declare
  v_org_id uuid := (select id from organisations where name = 'Demo Card Retailer' limit 1);
  v_game_id uuid := (select id from games where code = 'mtg');
  v_set_id uuid;
  v_lang_id uuid := (select id from languages where code = 'en');
  v_finish_id uuid := (select id from finishes where code = 'nonfoil');
  v_cond_id uuid := (select id from conditions where code = 'nm');
  v_status_id uuid := (select id from product_statuses where code = 'active');
  v_rule_id uuid;
  v_store_ids uuid[] := (select array_agg(id order by code) from fulfilment_nodes where organisation_id = v_org_id and type = 'store' and active);

  v_card record;
  v_oracle_id uuid;
  v_printing_id uuid;
  v_sku_id uuid;
  v_calc_id uuid;
  v_store_id uuid;
  v_qty integer;
  v_collector_number integer := 0;
begin
  if v_org_id is null or v_game_id is null or array_length(v_store_ids, 1) is null then
    raise exception 'seed_demo_catalogue: missing organisation/game/store fixtures -- run the Phase 0 seed first';
  end if;

  insert into sets (game_id, code, name, set_type, released_at)
  values (v_game_id, 'dsc', 'Demo Showcase', 'masters', current_date)
  returning id into v_set_id;

  insert into pricing_rules (organisation_id, name, source_price_type, target_currency, margin_type, margin_value)
  values (v_org_id, 'Demo Storefront Pricing', 'market', 'AUD', 'percentage', 0)
  returning id into v_rule_id;

  for v_card in
    select * from (values
      ('Sol Ring',              '{1}',      1, 'Artifact',                    'uncommon', array[]::text[], 12.50),
      ('Black Lotus',           '{0}',      0, 'Artifact',                    'mythic',   array[]::text[], 6500.00),
      ('Lightning Bolt',        '{R}',      1, 'Instant',                     'common',   array['R'],      3.50),
      ('Counterspell',          '{U}{U}',   2, 'Instant',                     'common',   array['U'],      2.95),
      ('Swords to Plowshares',  '{W}',      1, 'Instant',                     'uncommon', array['W'],      4.50),
      ('Dark Ritual',           '{B}',      1, 'Instant',                     'common',   array['B'],      1.50),
      ('Llanowar Elves',        '{G}',      1, 'Creature — Elf Druid',        'common',   array['G'],      2.25),
      ('Wrath of God',          '{2}{W}{W}',4, 'Sorcery',                     'rare',     array['W'],      15.00),
      ('Birds of Paradise',     '{G}',      1, 'Creature — Bird',             'rare',     array['G'],      22.00),
      ('Doubling Season',       '{4}{G}',   5, 'Enchantment',                 'rare',     array['G'],      48.95),
      ('Mana Crypt',            '{0}',      0, 'Artifact',                    'mythic',   array[]::text[], 249.95),
      ('Command Tower',         null,       0, 'Land',                       'common',   array[]::text[], 2.95),
      ('Cavern of Souls',       null,       0, 'Land',                       'rare',     array[]::text[], 89.95),
      ('Jeweled Lotus',         '{0}',      0, 'Artifact — Legendary',        'mythic',   array[]::text[], 189.95),
      ('Demonic Tutor',         '{B}',      1, 'Sorcery',                     'uncommon', array['B'],      18.50)
    ) as t(name, mana_cost, cmc, type_line, rarity, colors, price)
  loop
    v_collector_number := v_collector_number + 1;

    insert into oracle_cards (game_id, scryfall_oracle_id, name, mana_cost, cmc, type_line, colors, color_identity)
    values (v_game_id, gen_random_uuid(), v_card.name, v_card.mana_cost, v_card.cmc, v_card.type_line, v_card.colors, v_card.colors)
    returning id into v_oracle_id;

    insert into card_printings (oracle_card_id, set_id, collector_number, rarity, finishes, released_at)
    values (v_oracle_id, v_set_id, v_collector_number::text, v_card.rarity, array['nonfoil'], current_date)
    returning id into v_printing_id;

    insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id, product_status_id)
    values (v_printing_id, v_lang_id, v_finish_id, v_cond_id, v_status_id)
    returning id into v_sku_id;

    insert into calculated_prices (pricing_rule_id, sellable_sku_id, base_amount, base_currency, exchange_rate, margin_amount, final_amount, currency, status)
    values (v_rule_id, v_sku_id, v_card.price, 'AUD', 1, 0, v_card.price, 'AUD', 'approved')
    returning id into v_calc_id;

    insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency, status)
    values (v_org_id, v_rule_id, v_sku_id, v_calc_id, v_card.price, 'AUD', 'active');

    -- Stock at every store: resolveDefaultStore() (apps/web/src/lib/cart-session.ts)
    -- picks whichever active/online-fulfilment store comes back first with
    -- no ORDER BY, so add-to-cart resolves to an effectively arbitrary one
    -- of the four -- seeding only some stores per card left add-to-cart
    -- failing with "insufficient available inventory" whenever the
    -- resolved store wasn't one of the stocked ones.
    foreach v_store_id in array v_store_ids
    loop
      v_qty := 3 + (v_collector_number * 2) % 12;

      perform lock_inventory_balance(v_store_id, v_sku_id);

      insert into inventory_movements (
        organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
        quantity_delta, reference_type, reason
      ) values (
        v_org_id, v_store_id, v_sku_id, 'receive', v_qty, 'demo_catalogue_seed', 'demo catalogue seed'
      );

      update inventory_balances
      set quantity_on_hand = quantity_on_hand + v_qty,
          quantity_available_online = quantity_available_online + v_qty,
          updated_at = now()
      where fulfilment_node_id = v_store_id and sellable_sku_id = v_sku_id;
    end loop;
  end loop;
end $$;
