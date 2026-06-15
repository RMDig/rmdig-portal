"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// App Router global error boundary. Catches errors thrown while rendering the
// root layout / app shell — the one place a regular error.tsx can't reach —
// and reports them to Sentry. Without this, those client-side render failures
// never reach Sentry (P1.5: "Sentry captures unhandled errors"). global-error
// REPLACES the root layout, so it must render its own <html>/<body> and can't
// rely on globals.css — hence inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          backgroundColor: "#fafafa",
          color: "#171717",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#525252", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
            An unexpected error occurred. It&apos;s been reported and we&apos;ll look into it.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.6rem 1.25rem",
              fontSize: "1rem",
              fontWeight: 500,
              color: "#ffffff",
              backgroundColor: "#171717",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ color: "#a3a3a3", fontSize: "0.75rem", marginTop: "1.5rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
