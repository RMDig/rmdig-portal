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

// Sent by the portal when staff UPHOLD a review request (docs/plans/32). A
// lift is announced by AvServ's own "Incident Detection restored" email
// (contract restrictions.md §6), so the portal never emails on lift. Calm, no
// accusation, states the effect and what still works (plan 39 §3 tone). The
// staff decision note is internal and is not included.

export interface RestrictionReviewUpheldEmailProps {
  /** What the restriction takes away, e.g. "Automatic Incident Detection". */
  feature: string;
  /** AvServ's user-facing reason (contract §1 `userReason`). */
  userReason: string;
  reviewUrl: string;
}

export default function RestrictionReviewUpheldEmail({
  feature,
  userReason,
  reviewUrl,
}: RestrictionReviewUpheldEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>We reviewed your request about {feature}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>We reviewed your request</Heading>
          <Text style={paragraph}>
            Thank you for asking us to take another look. After reviewing it, we&apos;re keeping{" "}
            <strong>{feature}</strong> paused on your AvAI account for now.
          </Text>
          <Section style={noteBox}>
            <Text style={noteText}>{userReason}</Text>
          </Section>
          <Text style={paragraph}>
            Check-out, check-in and Send Help work exactly as before. Nothing about your safety
            alerts has changed.
          </Text>
          <Text style={paragraph}>
            You can see the details at <Link href={reviewUrl}>{reviewUrl}</Link>. If something
            has changed, you can ask for another review there later.
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you asked for a review of your AvAI account on
            rmdig.ai.
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
const noteText = { fontSize: "15px", lineHeight: "22px", color: "#404040", margin: "0", whiteSpace: "pre-wrap" as const };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
