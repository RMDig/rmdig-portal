import type { Metadata } from "next";
import Link from "next/link";

import DraftBanner from "@/components/legal/DraftBanner";
import LawyerPlaceholder from "@/components/legal/LawyerPlaceholder";
import { LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy — rmdig / AvAI",
  description:
    "How Rocky Mountain Digerati LLC collects, uses, and deletes personal data in the AvAI app and the rmdig portal.",
  path: "/privacy",
});

// The App Store Connect / Play Console privacy-policy URL points here, so this
// page must stay public (no auth) at a stable path, and its factual claims
// must MIRROR the app's declarations — ios/Runner/PrivacyInfo.xcprivacy and
// the Play Data Safety form (AvApp doc 02 P0-10/P0-11, doc 22 §3.5). If a
// data practice changes in the app, change it here in the same release.
export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Last updated: July 26, 2026</p>

      <div className="mt-8">
        <DraftBanner />
      </div>

      <div className="space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50 [&_h3]:font-semibold [&_h3]:text-neutral-900 dark:[&_h3]:text-neutral-50">
        <section>
          <h2>Who we are</h2>
          <p className="mt-3">
            {LEGAL_ENTITY}{" "}
            (&quot;rmdig&quot;, &quot;we&quot;) is a Colorado company. We
            operate the AvAI™ mobile app (a beta safety companion for backcountry travel),
            this website and web portal at rmdig.ai, and the self-hosted server
            infrastructure (&quot;AvServ&quot;) that powers AvAI&apos;s check-out/check-in
            safety feature. This policy covers all of them.
          </p>
        </section>

        <section>
          <h2>What we collect and why</h2>

          <h3 className="mt-5">Location (precise and coarse)</h3>
          <p className="mt-2">
            When you use AvAI&apos;s check-out/check-in feature, the app collects your
            device&apos;s precise and coarse location, linked to your account, and sends it
            to AvServ — servers we run ourselves. It is used for one purpose: app
            functionality. Concretely, that means keeping your last-known location current
            while a check-out is armed, sending that location to your emergency contact if
            you don&apos;t check in on time, and periodic device heartbeat reports. Photos
            you capture may also embed the capture location in their metadata; at this
            stage of the beta those stay on your device (see below).
          </p>
          <p className="mt-2">
            We do not use your location for advertising, profiling, or tracking, and we do
            not sell it. Precise geolocation is sensitive data under the Colorado Privacy
            Act; AvAI collects it only after you grant the operating-system location
            permission, and the app explains the safety purpose at the point of the
            permission prompt.
          </p>

          <h3 className="mt-5">Photos and captures</h3>
          <p className="mt-2">
            AvAI lets you capture snowpack profile and core photos in the field. In this
            release, your captures (the photos and their time, location and notes) stay on
            your phone. They are not uploaded to our servers or shared with anyone.
          </p>

          <h3 className="mt-5">Submitting photos to the research dataset (optional)</h3>
          <p className="mt-2">
            Submitting field photos and their labels is optional and isn&apos;t available yet.
            If you choose to submit them, a person reviews them, and they may be published in
            a public research dataset under the CC&nbsp;BY&nbsp;4.0 license. We plan to pay
            for accepted photos (see{" "}
            <Link href="/contribute" className="font-medium underline">
              rmdig.ai/contribute
            </Link>
            ), which will mean collecting the details needed to pay you.
          </p>
          <LawyerPlaceholder>
            [COUNSEL] Final submission wording, written once for v1 through upload: what is
            sent, consent, review, publication under CC BY 4.0, attribution, withdrawal,
            retention, and the payment details collected to pay for accepted photos. Mirror counsel&apos;s text here when it arrives; this paragraph and the
            retention table stay conditional until then.
          </LawyerPlaceholder>

          <h3 className="mt-5">Emergency contact details</h3>
          <p className="mt-2">
            To run the check-out/check-in feature you give AvAI the name and contact
            details (email address and, where provided, phone number) of the emergency
            contact you choose. We store these on AvServ and use them only to deliver the
            messages you set up: the one-time designation notice, any trip notice you choose
            to send, your safety alerts (overdue, Send&nbsp;Help and, if you use Incident
            Detection, automatic accident alerts), and their follow-up and all-clear
            messages. If you name someone as
            your emergency contact, please tell them — we hold their contact details on
            your instruction.
          </p>

          <h3 className="mt-5">Account data</h3>
          <p className="mt-2">
            A portal account includes your email address, a display name, and — for
            password sign-in — a salted hash of your password (never the password itself).
            If you sign in with Google, we receive your name, email, and profile image from
            Google. If you enable two-factor authentication, the TOTP secret is stored
            encrypted. Devices you link to your account are recorded so the safety features
            know which device is yours.
          </p>
          <p className="mt-2">
            If you register a search &amp; rescue organization or an advertiser account,
            we collect a contact name, contact email, and a contact phone number that we
            verify by one-time code. The phone number is kept as the organization&apos;s
            operational contact — we use it to reach you during application review and
            for account matters, never for marketing.
          </p>

          <h3 className="mt-5">Safety and telemetry records</h3>
          <p className="mt-2">
            AvServ keeps your check-out/check-in history (times, statuses, and the alerts
            it dispatched) and device heartbeat telemetry (periodic &quot;the device is
            reachable&quot; reports). These exist so the watchdog can work and so we can
            audit that an alert really fired.
          </p>
          <p className="mt-2">
            With them the app sends: the return times you set and any note you add to Send
            Help (relayed to your contact); the state of your phone during a check-out
            (battery, charging and low-power state, connectivity, notification permission,
            and how many updates are waiting to send); and a device ID the app generates
            for itself, which is not your phone&apos;s advertising or vendor identifier.
            Crash reports go to Sentry with your account, device ID, location, contacts and
            check-in details removed, so they are not linked to you.
          </p>

          <h3 className="mt-5">Automatic accident alerts (Incident Detection)</h3>
          <p className="mt-2">
            When Incident Detection is available, it is optional. It works only during an outing you have checked
            out for, and only when you have turned it on. The app watches your phone&apos;s
            motion sensors, on the phone itself, for a possible accident: for example a hard
            impact followed by no movement, or the sustained tumbling of being caught in an
            avalanche. It has two kinds of detection, each of which can be available on its
            own. If one detects a possible accident and you don&apos;t cancel the alarm, or
            you report an accident yourself, the phone sends AvServ:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>Impact detection:</strong> a summary of the motion and impact, the
              number of seconds the phone then went without movement, and your location at
              the moment of the incident.
            </li>
            <li>
              <strong>Avalanche-involvement detection:</strong> how long the phone tumbled,
              how far it descended (from the phone&apos;s barometer), and your location at
              the moment of the incident.
            </li>
          </ul>
          <p className="mt-2">
            The raw sensor readings are not sent.
          </p>
          <p className="mt-2">
            We use this for one purpose: sending an automatic alert, and its follow-up
            messages, to your emergency contact. The alert tells them what your phone
            reported (for example, a hard impact), when, and where, and that it may be a
            false alarm; the measurements themselves are not sent to them. No one else
            receives it. How long we keep it is in the retention table below.
          </p>
          <p className="mt-2">
            Separately, you can choose to turn on an on-phone motion buffer to help you
            report an incident later. It keeps the last few hours of motion and location
            readings in the app&apos;s private storage on your phone, deletes older readings
            automatically, and turning it off deletes it. It stays on your phone unless you
            choose to share it.
          </p>
        </section>

        <section>
          <h2>No tracking, no ads, no sale of data</h2>
          <p className="mt-3">
            AvAI does not track you across other companies&apos; apps or websites and sends
            no data to advertising or data-broker networks. The iOS privacy manifest
            declares tracking: none, with an empty tracking-domain list, and every data
            type it declares (listed under &quot;Apple privacy-manifest disclosures&quot;
            below) is marked &quot;not used for tracking.&quot; We do not sell personal
            data.
          </p>
        </section>

        <section>
          <h2>Who your data is shared with</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <span className="font-medium text-neutral-900 dark:text-neutral-50">Your emergency contact</span> —
              if an alert fires (overdue, Send&nbsp;Help, or an automatic accident alert),
              they receive your name, the alert, and your last-known location. That is the product working as described.
            </li>
            <li>
              <span className="font-medium text-neutral-900 dark:text-neutral-50">AvServ</span> — our own
              self-hosted servers. First-party infrastructure, not a third party.
            </li>
            <li>
              <span className="font-medium text-neutral-900 dark:text-neutral-50">Service providers</span> — we
              use Vercel (web hosting), Neon (database), Resend (transactional email),
              Twilio (SMS alert delivery), Sentry (error reporting), and Cloudflare
              (DNS/network) to run the service. They process data on our behalf and are not
              permitted to use it for their own purposes.
            </li>
            <li>
              <span className="font-medium text-neutral-900 dark:text-neutral-50">Legal requirements</span> — we
              may disclose data if required by law.{" "}
            </li>
          </ul>
          <p className="mt-3">No one else. There is no advertising or analytics sharing.</p>
        </section>

        <section>
          <h2>Were you added as someone&apos;s emergency contact?</h2>
          <p className="mt-3">
            If an AvAI user designated you as their emergency contact, we hold personal
            data about you even though you never signed up: your name and the contact
            details the user provided (phone number and/or email address), plus the state
            of our messaging relationship with you — whether your introductory notice was
            sent and whether you have opted out. We use this data only for the messages
            described under &quot;Text messages (SMS)&quot; below: a one-time notice telling
            you that you were designated, any trip notice the user chooses to send, and the
            safety alerts themselves (overdue, Send&nbsp;Help, and automatic accident alerts,
            with their follow-up and all-clear messages).
          </p>
          <p className="mt-3">
            You have the same rights as any data subject: reply{" "}
            <span className="font-medium text-neutral-900 dark:text-neutral-50">STOP</span>{" "}
            to end messages or{" "}
            <span className="font-medium text-neutral-900 dark:text-neutral-50">HELP</span>{" "}
            for assistance, and you can{" "}
            <Link href="/account/delete" className="font-medium underline">
              request deletion of your data
            </Link>{" "}
            or email {SUPPORT_EMAIL} — no account needed. See{" "}
            <Link href="/alerts" className="font-medium underline">
              what an AvAI alert means
            </Link>{" "}
            for what to do when one arrives, including the safety consequence of opting
            out.
          </p>
        </section>

        <section>
          <h2>Text messages (SMS)</h2>
          <p className="mt-3">
            AvAI&apos;s safety messages are delivered by SMS and email to the emergency
            contact an AvAI user designates. Messages are sent by our own servers through
            Twilio, our SMS delivery provider. The program sends only these messages:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>a one-time notice when someone is designated as an emergency contact;</li>
            <li>an optional trip notice, when the user chooses to send one as they head out;</li>
            <li>missed check-in alerts;</li>
            <li>Send&nbsp;Help alerts, and alerts when the user reports an accident;</li>
            <li>
              automatic accident alerts, during an outing with Incident Detection on, when
              the phone reports a possible accident (for example a hard impact followed by no
              movement, or the sustained tumbling of being caught in an avalanche) and the
              user doesn&apos;t respond; see &quot;Automatic accident alerts&quot; above for
              what the phone sends;
            </li>
            <li>all-clear, false-alarm, and duplicate-alert follow-ups;</li>
            <li>clearly labelled TEST DRILL messages used to verify the system;</li>
            <li>replies to YES, HELP, and STOP.</li>
          </ul>
          <p className="mt-3">
            We send no marketing or promotional texts, and message frequency depends entirely
            on the user&apos;s safety activity. Message and data rates may apply. Full program
            details, including the exact message texts, are published at{" "}
            <Link href="/sms" className="font-medium underline">
              rmdig.ai/sms
            </Link>
            .
          </p>
          <p className="mt-3">
            If you receive these messages, it is because an AvAI user listed your phone
            number as their emergency contact; alerts identify the user who named you. We
            ask users to get their contact&apos;s permission first. Reply{" "}
            <span className="font-medium text-neutral-900 dark:text-neutral-50">STOP</span>{" "}
            to opt out of further messages or{" "}
            <span className="font-medium text-neutral-900 dark:text-neutral-50">HELP</span>{" "}
            (or email {SUPPORT_EMAIL}) for assistance. Be aware of what opting out means
            here: if you text STOP, you will not receive that person&apos;s safety alerts,
            including a real overdue, Send&nbsp;Help, or accident alert — tell them so they can choose
            a different emergency contact.
          </p>
          <p className="mt-3">
            No mobile information will be shared with third parties or affiliates for
            marketing or promotional purposes. Phone numbers and message-consent
            information are used only to deliver the safety messages described above.
          </p>
        </section>

        <section>
          <h2>How long we keep data</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left text-neutral-900 dark:text-neutral-50">
                  <th className="py-2 pr-4 font-semibold">Data</th>
                  <th className="py-2 font-semibold">Retention</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_td]:pr-4 [&_tr]:border-b [&_tr]:border-neutral-200 dark:[&_tr]:border-neutral-800">
                <tr>
                  <td>Photos and captures (time, location, notes)</td>
                  <td>On your phone only — you control them; deleting the app removes them</td>
                </tr>
                <tr>
                  <td>Check-out/check-in history</td>
                  <td>About 90 days, then deleted; deletable earlier on request</td>
                </tr>
                <tr>
                  <td>Incident Detection summary and location</td>
                  <td>
                    90 days after the incident ends (cancelled or resolved), then deleted.
                    What remains is a record of the incident without location or motion
                    data: its type, times, and outcome.
                  </td>
                </tr>
                <tr>
                  <td>On-phone motion buffer</td>
                  <td>On your phone only; the last few hours, deleted as it rolls over or when you turn it off</td>
                </tr>
                <tr>
                  <td>Device heartbeat telemetry</td>
                  <td>7 days, then reduced to aggregate statistics</td>
                </tr>
                <tr>
                  <td>Submitted photos and labels (only if you choose to submit them)</td>
                  <td>[COUNSEL] to supply, with the submission wording above</td>
                </tr>
                <tr>
                  <td>Emergency contact details</td>
                  <td>Until you change them or delete your account</td>
                </tr>
                <tr>
                  <td>Account data</td>
                  <td>While your account is active, plus up to 30 days after deletion completes</td>
                </tr>
                <tr>
                  <td>Encrypted database backups</td>
                  <td>
                    30 days, then deleted. Data removed by a deletion request ages out
                    of backups on the same schedule.
                  </td>
                </tr>
                <tr>
                  <td>SMS opt-out records</td>
                  <td>
                    Retained indefinitely as a suppression list — deleting an opt-out
                    record would cause us to contact someone who told us to stop. This
                    compliance-basis retention survives other deletion requests; it holds
                    only the phone number and the opt-out fact.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            These windows are our operating practice while the service is in beta; final
            retention terms are part of the legal review noted at the top of this page.
          </p>
          <LawyerPlaceholder>
            How long the incident record without location or motion data is kept, and
            counsel&apos;s confirmation of the 90-day Incident Detection window under the
            Colorado Privacy Act. Operator/counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>Your rights (Colorado Privacy Act)</h2>
          <p className="mt-3">
            If you are a Colorado resident, you have the right to access, correct, and
            delete the personal data we hold about you, to obtain a portable copy, and to
            opt out of targeted advertising, sale, and certain profiling — none of which we
            do in the first place. Precise geolocation is sensitive data under the CPA, and
            we collect it only with the consent described above.
          </p>
          <p className="mt-3">
            To delete your data,{" "}
            <Link href="/account/delete" className="font-medium underline">
              submit a deletion request
            </Link>{" "}
            — it works whether or not you have a portal account. For access or correction
            requests, email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
            . We respond within 45 days.
          </p>
          <LawyerPlaceholder>
            CPA appeal-process language: how a user appeals a refused request, and the
            Colorado Attorney General contact reference. Counsel to supply.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>Apple privacy-manifest disclosures</h2>
          <p className="mt-3">
            For transparency, the iOS app&apos;s privacy manifest declares the data the app
            sends, each used for app functionality only and not used for tracking. Linked to
            your account: your name and email address; the emergency contacts you type in;
            precise and coarse location; a device ID the app generates (not Apple&apos;s
            advertising or vendor identifier); other content you enter (return times and the
            Send Help note); and other diagnostic data (your phone&apos;s state during a
            check-out). Not linked to you: crash data. Photos are not declared because they
            stay on your phone. The app does no tracking. The manifest also declares the app&apos;s use of four
            &quot;required-reason&quot; system APIs, in each case for ordinary app
            operation rather than fingerprinting: user preferences storage (CA92.1), file
            timestamps (C617.1), free disk space (E174.1), and system boot time (35F9.1).
          </p>
        </section>

        <section>
          <h2>Security</h2>
          <p className="mt-3">
            Data moves between the app, this site, and our servers over encrypted
            connections (TLS). Passwords are stored only as salted hashes, two-factor
            secrets are stored encrypted, and recovery and reset tokens are stored only as
            one-way hashes. No system is immune to compromise; if a breach affects your
            data, we will notify you as the law requires.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p className="mt-3">
            AvAI and the rmdig portal are not directed to children under 13, and we do not
            knowingly collect their data.
          </p>
          <LawyerPlaceholder>
            [COUNSEL] Reconcile the minimum age. This page says AvAI is not directed to
            children under 13, but the AvAI user agreement requires users to be 18 or older
            (a tick-box). Counsel to set one age and supply the final children&apos;s-privacy
            clause (COPPA scope) consistent with the Terms of Service.
          </LawyerPlaceholder>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p className="mt-3">
            We will post any changes on this page and update the date at the top. For
            material changes — like the future photo-submission feature — we will also
            notify you in the app before the change takes effect.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p className="mt-3">
            {LEGAL_ENTITY}
            <br />
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
          <LawyerPlaceholder>
            Registered mailing address for privacy correspondence. Operator/counsel to
            supply.
          </LawyerPlaceholder>
        </section>
      </div>
    </article>
  );
}
