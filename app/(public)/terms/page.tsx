import type { Metadata } from "next";
import Link from "next/link";

import DraftBanner from "@/components/legal/DraftBanner";
import LawyerPlaceholder from "@/components/legal/LawyerPlaceholder";
import {
  BETA_DISCLOSURE,
  LEGAL_ENTITY,
  SUPPORT_EMAIL,
} from "@/lib/legal/compliance-copy";

export const metadata: Metadata = {
  title: "Terms of Service — rmdig / AvAI",
  description:
    "Terms of Service for the AvAI app and the rmdig portal, operated by Rocky Mountain Digerati LLC.",
};

// Public, no-auth, stable URL — referenced from the app's Settings links and
// the store listings. Operative legal language is intentionally a set of
// [LAWYER] placeholders (live engagement, AvApp doc 17); the factual service
// description and safety framing below are the parts we may author.
export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Last updated: July 26, 2026</p>

      <div className="mt-8">
        <DraftBanner />
      </div>

      <div className="space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section>
          <h2>1. Agreement</h2>
          <p className="mt-3">
            These terms govern your use of the AvAI™ mobile app and the rmdig web portal,
            operated by {LEGAL_ENTITY} (&quot;rmdig&quot;, &quot;we&quot;).
          </p>
          <LawyerPlaceholder>
            Binding acceptance clause (assent mechanics, minimum age, authority to accept
            on behalf of an organization). Counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>2. What AvAI is — and is not</h2>
          <p className="mt-3">
            AvAI is a safety companion app: you schedule a check-in before a backcountry
            trip, and if you don&apos;t check in on time, our servers alert your emergency
            contact with your last-known location. Checking out requires cell or internet
            signal.
          </p>
          <p className="mt-3 font-medium text-neutral-900 dark:text-neutral-50">{BETA_DISCLOSURE}</p>
          <p className="mt-3">
            AvAI is operated by a small team and may have outages of hours or days. It is
            not an emergency service, does not contact 911 or rescue services on your
            behalf, and must not be your only safety system. Carry a second safety plan —
            partner check-ins, a satellite messenger, a filed trip plan, formal training.
          </p>
          <p className="mt-3">
            Alert delivery is designed for safety, not tidiness: once you designate an
            emergency contact, alerts flow to them by default — no confirmation from the
            contact is required first — and the delivery design favors sending an alert
            twice over risking not sending it at all, so your contact may occasionally
            receive duplicate messages. A contact who opts out (for example by replying
            STOP to a text) stops receiving your alerts, and you are told so you can
            designate someone else.
          </p>
          <LawyerPlaceholder>
            Assumption-of-risk and no-reliance clause for backcountry activity, consistent
            with the beta disclosure above. Counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>3. Your account and responsibilities</h2>
          <p className="mt-3">
            Keep your credentials secure and your emergency-contact details accurate — the
            alert path is only as good as the contact information you give it. By
            designating an emergency contact you confirm that you have that person&apos;s
            permission to share their name and contact details with us and to have them
            receive messages about you (this mirrors the disclosure shown in the app when
            you designate them). Tell your contact what an AvAI alert means —{" "}
            <Link href="/alerts" className="font-medium underline">
              this page explains it
            </Link>
            .
          </p>
          <LawyerPlaceholder>
            Account terms: acceptable use, prohibited conduct, suspension and termination
            rights; formalization of the contact-permission attestation above as a
            warranty. Counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>4. Your content</h2>
          <p className="mt-3">
            Photos you capture with AvAI stay on your device at this stage of the beta. A
            future dataset-contribution feature, if launched, will have its own explicit
            consent flow and terms.
          </p>
          <LawyerPlaceholder>
            User-content license terms (scope of license for any future contributed
            content; CC-BY-4.0 dataset mechanics per AvApp doc 19 when that feature
            ships). Counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>5. Privacy</h2>
          <p className="mt-3">
            How we handle your data is described in the{" "}
            <Link href="/privacy" className="font-medium underline">
              Privacy Policy
            </Link>
            , including how to{" "}
            <Link href="/account/delete" className="font-medium underline">
              request deletion of your data
            </Link>
            .
          </p>
        </section>

        <section>
          <h2>6. Disclaimers, liability, disputes</h2>
          <LawyerPlaceholder>
            Warranty disclaimer, limitation of liability, indemnification, governing law
            (Colorado) and venue, dispute-resolution terms. Counsel to supply — these are
            the core operative clauses of the lawyer engagement and will not be drafted
            in-house.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>7. Changes</h2>
          <p className="mt-3">
            We may update these terms; we will post changes here and update the date above,
            and notify you in the app of material changes before they take effect.
          </p>
        </section>

        <section>
          <h2>8. Contact</h2>
          <p className="mt-3">
            {LEGAL_ENTITY} —{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      </div>
    </article>
  );
}
