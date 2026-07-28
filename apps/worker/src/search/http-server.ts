import http from "node:http";

import type { Sql } from "postgres";
import type { SearchQueryParams } from "@probable-winner/search";

import { getIndexStats, rebuildFullIndex, search } from "./index-store.js";
import { updateAllPopularityScores } from "../jobs/calculate-popularity-score.js";
import { logger } from "../logger.js";

const AUTH_HEADER = "x-search-service-token";

function parseSearchParams(url: URL): SearchQueryParams {
  const params = url.searchParams;

  return {
    q: params.get("q") ?? undefined,
    set: params.get("set") ?? undefined,
    collectorNumber: params.get("collectorNumber") ?? undefined,
    artist: params.get("artist") ?? undefined,
    rarity: params.get("rarity") ?? undefined,
    finish: params.get("finish") ?? undefined,
    condition: params.get("condition") ?? undefined,
    colour: params.getAll("colour"),
    format: params.get("format") ?? undefined,
    minPrice: params.get("minPrice") ? Number(params.get("minPrice")) : undefined,
    maxPrice: params.get("maxPrice") ? Number(params.get("maxPrice")) : undefined,
    inStock: params.get("inStock") === "true",
    storeId: params.get("storeId") ?? undefined,
    page: params.get("page") ? Number(params.get("page")) : undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    sort: (params.get("sort") as SearchQueryParams["sort"] | null) ?? undefined,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.SEARCH_SERVICE_TOKEN;
  // No token configured means no server -- refuse to serve rather than run
  // an unauthenticated API exposing pricing/stock across every store.
  if (!token) return false;
  return req.headers[AUTH_HEADER] === token;
}

// `sql` is threaded in (rather than each admin route importing ./db.js
// itself) so this module stays testable without a live Postgres connection.
export function startSearchHttpServer(sql: Sql): http.Server {
  const port = Number(process.env.SEARCH_SERVICE_PORT ?? 8087);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", ...getIndexStats() });
      return;
    }

    if (url.pathname === "/search" && req.method === "GET") {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      try {
        const result = search(parseSearchParams(url));
        sendJson(res, 200, result);
      } catch (error) {
        logger.error("search request failed", { error: logger.serializeError(error) });
        sendJson(res, 500, { error: "Search failed" });
      }
      return;
    }

    // Manual reindex/popularity-recalculation triggers (pnpm --filter worker
    // reindex-search / update-popularity-scores) run as separate, short-lived
    // processes -- without these, they'd rebuild an index in their own
    // throwaway process memory that the actual running worker never sees.
    // Routing them through the live worker's own HTTP server instead keeps
    // "run the script" an operation with an immediate, visible effect on
    // live search, same as it was when Typesense held this state externally.
    if (url.pathname === "/admin/reindex" && req.method === "POST") {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      rebuildFullIndex(sql)
        .then((result) => sendJson(res, 200, result))
        .catch((error: unknown) => {
          logger.error("admin reindex failed", { error: logger.serializeError(error) });
          sendJson(res, 500, { error: "Reindex failed" });
        });
      return;
    }

    if (url.pathname === "/admin/recalculate-popularity-scores" && req.method === "POST") {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      updateAllPopularityScores(sql)
        .then((result) => sendJson(res, 200, result))
        .catch((error: unknown) => {
          logger.error("admin popularity recalculation failed", {
            error: logger.serializeError(error),
          });
          sendJson(res, 500, { error: "Popularity recalculation failed" });
        });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(port, () => {
    logger.info("search HTTP server listening", { port });
  });

  return server;
}
