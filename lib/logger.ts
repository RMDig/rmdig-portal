import { createHmac } from "node:crypto";

import pino from "pino";

import { env } from "./env";

// Field names that should never appear in logs in plaintext. Pino's redact lets
// us list path patterns; each match gets replaced with "[REDACTED]" before the
// log line is serialized.
//
// Patterns cover both flat and nested objects. e.g., logger.info({ user }) where
// user has a password_hash field — "*.password_hash" catches the nested one.
const redactPaths = [
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "claim_token",
  "claimToken",
  "secret",
  "authorization",
  "cookie",
  "sessionToken",
  "session_token",
  "*.password",
  "*.passwordHash",
  "*.password_hash",
  "*.token",
  "*.secret",
  "*.authorization",
  "*.cookie",
  "*.sessionToken",
  "*.session_token",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.Cookie",
  "headers.authorization",
  "headers.cookie",
  // Phone numbers are never needed in a log line (plan 36 H6): user and SAR org
  // phones, contact numbers. Redacted outright, not pseudonymized.
  "phone",
  "phoneE164",
  "contactPhone",
  "*.phone",
  "*.phoneE164",
  "*.contactPhone",
];

// Email addresses are pseudonymized rather than removed: the same address gives
// the same value on every line, so an operator can still follow one address
// through sign-up, rate limits and email delivery without the log holding the
// address itself. Keyed (from NEXTAUTH_SECRET, like lib/phone/proof.ts) so a
// list of candidate addresses can't be hashed and matched against leaked logs.
// `to` is every email send's recipient (lib/email/send.ts).
const pseudonymPaths = ["email", "to", "*.email"];

// Client IPs the same way (plan 36 H6): still traceable across lines (a rate-
// limited network, a burst of sign-ins) without the log holding the address.
const ipPaths = ["ip", "*.ip"];

function pseudonymKey(): Buffer {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update("rmdig log email pseudonym v1").digest();
}

function ipPseudonymKey(): Buffer {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update("rmdig log ip pseudonym v1").digest();
}

/** "i:" plus 16 hex characters of HMAC-SHA256 over the address. */
export function pseudonymizeIp(value: unknown): unknown {
  if (typeof value !== "string") return "[REDACTED]";
  return `i:${createHmac("sha256", ipPseudonymKey()).update(value.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

/** "e:" plus 16 hex characters of HMAC-SHA256 over the trimmed, lowercased
 *  address. Anything that isn't a string (a recipient list) is mapped item by
 *  item; other values are redacted outright. */
export function pseudonymizeEmail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pseudonymizeEmail);
  if (typeof value !== "string") return "[REDACTED]";
  const digest = createHmac("sha256", pseudonymKey()).update(value.trim().toLowerCase()).digest("hex");
  return `e:${digest.slice(0, 16)}`;
}

/** Pino's redact config: secrets become "[REDACTED]", addresses a pseudonym. */
export const redactOptions = {
  paths: [...redactPaths, ...pseudonymPaths, ...ipPaths],
  censor: (value: unknown, path: string[]): unknown =>
    pseudonymPaths.some((p) => matchesPath(p, path))
      ? pseudonymizeEmail(value)
      : ipPaths.some((p) => matchesPath(p, path))
        ? pseudonymizeIp(value)
        : "[REDACTED]",
};

function matchesPath(pattern: string, path: string[]): boolean {
  const parts = pattern.split(".");
  return parts.length === path.length && parts.every((p, i) => p === "*" || p === path[i]);
}

const isProd = env.NODE_ENV === "production";
const isTest = env.NODE_ENV === "test";

export const logger = pino({
  level: isProd ? "info" : isTest ? "silent" : "debug",
  redact: redactOptions,
  base: {
    env: env.NODE_ENV,
    commit: env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? "unknown",
  },
  // Pretty output in local dev; raw JSON in production so Vercel's log pipeline
  // can parse it. Tests are silent.
  ...(!isProd &&
    !isTest && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
    }),
});
