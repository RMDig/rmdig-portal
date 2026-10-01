// Postgres error classification shared by server actions.

// True when err is Postgres unique_violation (23505), so an action can turn a
// duplicate into a friendly answer instead of the generic failure. The neon
// driver puts the SQLSTATE on err.code; some wrappers nest it under cause.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
