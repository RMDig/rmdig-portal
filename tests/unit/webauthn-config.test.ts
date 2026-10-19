import { describe, expect, it } from "vitest";

import { relyingPartyFor } from "@/lib/auth/webauthn-config";

describe("relyingPartyFor", () => {
  it("scopes production passkeys to rmdig.ai", () => {
    expect(relyingPartyFor("rmdig.ai")).toEqual({ rpID: "rmdig.ai", origin: "https://rmdig.ai" });
    expect(relyingPartyFor("RMDIG.AI")).toEqual({ rpID: "rmdig.ai", origin: "https://rmdig.ai" });
  });

  it("uses localhost for dev and a preview's own host for previews", () => {
    expect(relyingPartyFor("localhost:3000")).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
    expect(relyingPartyFor("rmdig-portal-git-x.vercel.app")).toEqual({
      rpID: "rmdig-portal-git-x.vercel.app",
      origin: "https://rmdig-portal-git-x.vercel.app",
    });
  });

  it("refuses any other host rather than guess", () => {
    for (const h of [null, "app.rmdig.ai", "evil.example", "rmdig.ai.evil.example", "localhost.evil.example", "a.b.vercel.app"]) {
      expect(relyingPartyFor(h), String(h)).toBeNull();
    }
  });
});
