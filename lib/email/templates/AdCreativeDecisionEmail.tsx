import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type AdCreativeDecision = "approved" | "rejected" | "changes_requested" | "suspended";

export interface AdCreativeDecisionEmailProps {
  advertiserName: string;
  headline: string;
  decision: AdCreativeDecision;
  // The operator's note. Required copy for rejected / changes_requested,
  // optional for suspended; ignored for approved.
  note?: string;
  /** The creative's page in the portal (its edit page for changes requested). */
  creativeUrl: string;
  /** Approved only: whether it reached the app. Publishing can fail and be
   *  retried, so the email never says "in the app" before it is. */
  published?: boolean;
}

const COPY: Record<AdCreativeDecision, { heading: string; preview: string; body: string }> = {
  approved: {
    heading: "Your ad creative is approved",
    preview: "Your ad creative was approved",
    body: "is approved and published to the app.",
  },
  rejected: {
    heading: "An update on your ad creative",
    preview: "An update on your ad creative",
    body: "was not approved. See the note below for details.",
  },
  changes_requested: {
    heading: "We need a few changes",
    preview: "Your ad creative needs changes",
    body: "needs some changes before we can approve it. See the note below, then update and resubmit.",
  },
  suspended: {
    heading: "Your ad creative is paused",
    preview: "Your ad creative was taken out of the app",
    body: "has been taken out of the app. Any note from our team is below.",
  },
};

// One template for all three review outcomes — copy + whether the note renders are
// driven by `decision`. Mirrors SarOrgDecisionEmail.
export default function AdCreativeDecisionEmail({
  advertiserName,
  headline,
  decision,
  note,
  creativeUrl,
  published,
}: AdCreativeDecisionEmailProps) {
  const copy = COPY[decision];
  const sentence =
    decision === "approved" && !published ? "is approved. It isn't in the app yet; we'll publish it shortly." : copy.body;
  const showNote = decision !== "approved" && !!note;
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{copy.heading}</Heading>
          <Text style={paragraph}>
            Your creative “<strong>{headline}</strong>” for <strong>{advertiserName}</strong>{" "}
            {sentence}
          </Text>
          {showNote ? (
            <Section style={noteBox}>
              <Text style={noteText}>{note}</Text>
            </Section>
          ) : null}
          <Section style={buttonContainer}>
            <Link href={creativeUrl} style={button}>
              {decision === "changes_requested" ? "Edit your creative" : "View your creative"}
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you manage advertising for {advertiserName} on rmdig.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = {
  margin: "40px auto",
  padding: "32px",
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  maxWidth: "560px",
};
const heading = { fontSize: "24px", fontWeight: "600", color: "#171717", margin: "0 0 16px" };
const paragraph = { fontSize: "16px", lineHeight: "24px", color: "#404040", margin: "16px 0" };
const noteBox = {
  margin: "16px 0",
  padding: "16px",
  backgroundColor: "#f5f5f5",
  borderRadius: "6px",
  borderLeft: "3px solid #d4d4d4",
};
const noteText = {
  fontSize: "15px",
  lineHeight: "22px",
  color: "#404040",
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};
const buttonContainer = { textAlign: "center" as const, margin: "32px 0" };
const button = {
  display: "inline-block",
  padding: "12px 24px",
  backgroundColor: "#171717",
  color: "#ffffff",
  borderRadius: "6px",
  fontSize: "16px",
  fontWeight: "500",
  textDecoration: "none",
};
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
