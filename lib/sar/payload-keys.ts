import type { KeySet } from "../crypto/keyed-aes";
import { env } from "../env";
import { parseSarPayloadKeys } from "./payload-seal";

// The SAR payload key set from env (lib/sar/payload-seal.ts), parsed on first
// use. Server-only. Throws when SAR_PAYLOAD_KEYS is unset or malformed.

let keySet: KeySet | null = null;

export function sarPayloadKeys(): KeySet {
  keySet ??= parseSarPayloadKeys(env.SAR_PAYLOAD_KEYS);
  return keySet;
}
