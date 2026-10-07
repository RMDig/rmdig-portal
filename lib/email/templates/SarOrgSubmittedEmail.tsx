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

export interface SarOrgSubmittedEmailProps {
  orgName: string;
  /** The application's status page in the portal. */
  statusUrl: string;
}

// Confirmation to the SAR admin who submitted an org application. Sets the
// expectation that approval is manual (review by an rmdig operator).
export default function SarOrgSubmittedEmail({ orgName, statusUrl }: SarOrgSubmittedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>We received your SAR organization application for {orgName}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Application received</Heading>
          <Text style={paragraph}>
            Thanks for applying to register <strong>{orgName}</strong> as a search-and-rescue
            organization on rmdig.
          </Text>
          <Text style={paragraph}>
            Our staff review every application, and call to confirm where needed, before approving
            it. We&apos;ll email you when there&apos;s a decision or if we need anything else from
            you.
          </Text>
          <Section style={buttonContainer}>
            <Link href={statusUrl} style={button}>
              See your application
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you submitted an application on rmdig. No action is
            needed right now.
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
