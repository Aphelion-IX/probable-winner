import http from "node:http";

import type { Sql } from "postgres";

import { getIndexStats, persistSnapshotToStorage, rebuildFullIndex } from "./index-store.js";
import { updateAllPopularityScores } from "../jobs/calculate-popularity-score.js";
import { logger } from "../logger.js";

// apps/web reads the search index directly from the Storage snapshot this
// worker persists (apps/web/src/lib/search-index-cache.ts) rather than
// calling this server for queries -- Vercel serverless functions are the
// only deployment target available, and there's no persistently-reachable
// worker service to call for reads. This server exists for the pieces that
// genuinely need the live, in-memory index in this specific process:
// health/monitoring, and the manual reindex/popularity-recalculation
// triggers below.
const AUTH_HEADER = "x-search-service-token";

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
  // No token configured means no admin access -- refuse rather than run an
  // unauthenticated trigger for a full reindex/recalculation.
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

    // Manual reindex/popularity-recalculation triggers (pnpm --filter worker
    // reindex-search / update-popularity-scores) run as separate, short-lived
    // processes -- without these, they'd rebuild an index in their own
    // throwaway process memory that the actual running worker never sees.
    // Routing them through the live worker's own HTTP server instead keeps
    // "run the script" an operation with an immediate, visible effect --
    // the rebuilt index gets persisted to Storage, where apps/web will pick
    // it up on its own next refresh.
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
        .then(async (result) => {
          // patchPopularityScore only mutates this process's in-memory
          // index -- persist explicitly so apps/web's next refresh picks
          // this up promptly instead of waiting for the periodic snapshot.
          await persistSnapshotToStorage();
          sendJson(res, 200, result);
        })
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
