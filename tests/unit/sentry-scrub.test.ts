import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubEvent, scrubString } from "@/lib/sentry-scrub";

// What reaches Sentry carries no email address, cookie, auth header or link
// token: a deletion requester's or SAR member's address must not be copied
// into a third-party error tracker.

describe("scrubEvent", () => {
  it("masks email addresses and link tokens in strings", () => {
    expect(scrubString("send to lead@sar.org failed")).toBe("send to [email] failed");
    expect(scrubString("https://rmdig.ai/reset?token=abc123&x=1")).toBe("https://rmdig.ai/reset?token=[redacted]&x=1");
  });

  it("scrubs messages, exceptions, extra, breadcrumbs, the user and the request", () => {
    const event = {
      message: "for a@b.co",
      exception: { values: [{ type: "Error", value: "Resend rejected x@y.org" }] },
      extra: { to: "lead@sar.org", nested: { list: ["disp@sar.org"] }, count: 2 },
      breadcrumbs: [{ message: "user c@d.io signed in", data: { email: "c@d.io" } }],
      user: { id: "u1", email: "u@x.org", ip_address: "203.0.113.9" },
      request: {
        url: "https://rmdig.ai/account/delete/confirm?token=secret",
        cookies: { session: "s" },
        data: "password=hunter2",
        headers: { Authorization: "Bearer t", cookie: "s=1", "user-agent": "ua" },
      },
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrubEvent(event));
    for (const leaked of ["a@b.co", "x@y.org", "lead@sar.org", "disp@sar.org", "c@d.io", "u@x.org", "203.0.113.9", "secret", "hunter2", "Bearer t", "s=1"]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('"id":"u1"');
    expect(out).toContain("user-agent");
    expect(event.extra).toMatchObject({ count: 2 });
  });
});
