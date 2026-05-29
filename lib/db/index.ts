import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import * as schema from "./schema";

// Tuned for Vercel serverless against Neon's PgBouncer pooler:
// prepare:false is required (transaction-mode pooling can't reuse prepared
// statements); max:1 keeps one connection per warm lambda instance so a
// burst of cold starts can't exhaust Neon's connection cap.
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
