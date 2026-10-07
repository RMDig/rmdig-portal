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

export interface SarOrgPendingReviewEmailProps {
  orgName: string;
  submitterEmail: string;
  reviewUrl: string;
}

// Notification to rmdig platform admins that a new SAR org is awaiting review.
// Links straight to the approvals queue.
export default function SarOrgPendingReviewEmail({
  orgName,
  submitterEmail,
  reviewUrl,
}: SarOrgPendingReviewEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>A SAR organization is awaiting review: {orgName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>New SAR org awaiting review</Heading>
          <Text style={paragraph}>
            <strong>{orgName}</strong> was submitted by {submitterEmail} and is pending approval.
          </Text>
          <Section style={buttonContainer}>
            <Link href={reviewUrl} style={button}>
              Open the approvals queue
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you review search &amp; rescue applications on rmdig.
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
