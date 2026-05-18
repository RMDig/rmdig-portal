import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Tuned for Vercel serverless against Neon's PgBouncer pooler:
// prepare:false is required (transaction-mode pooling can't reuse prepared
// statements); max:1 keeps one connection per warm lambda instance so a
// burst of cold starts can't exhaust Neon's connection cap.
const client = postgres(connectionString, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
