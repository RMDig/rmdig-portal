import { headers } from "next/headers";

// First hop of x-forwarded-for is the client IP on Vercel (the platform
// appends, so the leftmost entry is what reached the edge). Headerless
// requests (local dev, direct invocation) share one "unknown" bucket rather
// than bypassing IP-keyed rate limits — fail closed, not open.
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
