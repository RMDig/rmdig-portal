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
];

const isProd = env.NODE_ENV === "production";
const isTest = env.NODE_ENV === "test";

export const logger = pino({
  level: isProd ? "info" : isTest ? "silent" : "debug",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
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
