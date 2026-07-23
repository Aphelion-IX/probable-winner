import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required — the worker connects directly to Postgres, not through the REST API.",
  );
}

export const sql = postgres(connectionString, { max: 5 });
