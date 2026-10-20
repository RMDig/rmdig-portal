import { describe, expect, it } from "vitest";

import { tlsFor } from "@/lib/db/tls";

describe("tlsFor (plan 36 H5)", () => {
  it("requires TLS for every remote database", () => {
    expect(tlsFor("postgresql://u:p@ep-crimson-thunder-aqloj3r3-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require")).toBe("require");
    expect(tlsFor("postgresql://u:p@db.example/x?sslmode=disable")).toBe("require");
  });

  it("allows a loopback database without it (a throwaway test Postgres)", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]"]) expect(tlsFor(`postgresql://u:p@${h}:5432/x`), h).toBe(false);
  });

  it("never downgrades a URL it can't read", () => {
    expect(tlsFor("not a url")).toBe("require");
  });
});
