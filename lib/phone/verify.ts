import { env } from "@/lib/env";

// Twilio Verify (OTP) client for org-creation phone verification. Fetch-based
// on purpose — the twilio SDK is a heavy dependency for two POST endpoints.
// Same lazy/fail-loud contract as lib/email/send: deploys without the creds
// boot fine and report verification as disabled; actually exercising the API
// unconfigured throws loudly. Verify OTPs are delivered from Twilio's own
// verified senders, not our A2P campaign number, so nothing here touches the
// 10DLC filing.

export class PhoneVerifyError extends Error {}

export function phoneVerificationEnabled(): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID,
  );
}

// US/Canada (NANP) number → E.164 (+1XXXXXXXXXX), or null if it isn't one.
// US-only is deliberate at this rung — SAR orgs and advertisers are US
// entities today; widen when a real non-US org shows up, not before.
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // NANP: neither the area code nor the exchange may start with 0 or 1.
  if (["0", "1"].includes(ten[0] ?? "") || ["0", "1"].includes(ten[3] ?? "")) return null;
  return `+1${ten}`;
}

async function verifyApi(
  resource: "Verifications" | "VerificationCheck",
  body: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!phoneVerificationEnabled()) {
    throw new PhoneVerifyError(
      "Phone verification is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID).",
    );
  }
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${resource}`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

// Text an OTP to the number. Throws PhoneVerifyError on any API failure —
// callers surface a user-visible error and log; nothing is swallowed (§3.2).
export async function startPhoneVerification(phoneE164: string): Promise<void> {
  const { status, json } = await verifyApi("Verifications", { To: phoneE164, Channel: "sms" });
  if (status < 200 || status >= 300) {
    throw new PhoneVerifyError(
      `Twilio Verify start failed (HTTP ${status}): ${String(json.message ?? "no message")}`,
    );
  }
}

// True iff the code matches the pending verification for the number. A 404
// means no pending verification (expired ~10 min, or never started) — that's
// a normal wrong-code outcome for the user, not an API failure.
export async function checkPhoneVerification(phoneE164: string, code: string): Promise<boolean> {
  const { status, json } = await verifyApi("VerificationCheck", { To: phoneE164, Code: code });
  if (status === 404) return false;
  if (status < 200 || status >= 300) {
    throw new PhoneVerifyError(
      `Twilio Verify check failed (HTTP ${status}): ${String(json.message ?? "no message")}`,
    );
  }
  return json.status === "approved";
}
