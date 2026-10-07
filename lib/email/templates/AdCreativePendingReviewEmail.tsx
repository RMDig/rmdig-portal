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

export interface AdCreativePendingReviewEmailProps {
  advertiserName: string;
  headline: string;
  reviewUrl: string;
}

// Notification to rmdig platform admins that an ad creative is awaiting review.
// Links straight to the ad-approvals queue. Mirrors SarOrgPendingReviewEmail.
export default function AdCreativePendingReviewEmail({
  advertiserName,
  headline,
  reviewUrl,
}: AdCreativePendingReviewEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>An ad is awaiting review: {headline}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>New ad awaiting review</Heading>
          <Text style={paragraph}>
            <strong>{advertiserName}</strong> submitted the ad “<strong>{headline}</strong>”
            for review. No creative reaches the app until it&apos;s approved.
          </Text>
          <Section style={buttonContainer}>
            <Link href={reviewUrl} style={button}>
              Open the ad-approvals queue
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you hold an rmdig reviewer/admin platform role.
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
