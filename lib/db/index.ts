import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import { tlsFor } from "./tls";
import * as schema from "./schema";

// Tuned for Vercel serverless against Neon's PgBouncer pooler:
// prepare:false is required (transaction-mode pooling can't reuse prepared
// statements); max:1 keeps one connection per warm lambda instance so a
// burst of cold starts can't exhaust Neon's connection cap. TLS is required
// in code, not left to the URL's sslmode (plan 36 H5), except on a loopback
// database (a throwaway local Postgres for tests has no TLS).
const client = postgres(env.DATABASE_URL, {
  ssl: tlsFor(env.DATABASE_URL),
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
