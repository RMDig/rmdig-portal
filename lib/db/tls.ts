// Whether the database connection must use TLS (plan 36 H5). Every real
// database (Neon) is remote, so TLS is required; a loopback host is a local
// throwaway Postgres for tests, which has none. Pure, so it's unit-tested.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function tlsFor(databaseUrl: string): "require" | false {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // An unparseable URL fails at connect anyway; never downgrade it to plaintext.
    return "require";
  }
  return LOOPBACK.has(host) ? false : "require";
}
