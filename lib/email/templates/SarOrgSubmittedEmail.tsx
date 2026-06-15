import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export interface SarOrgSubmittedEmailProps {
  orgName: string;
}

// Confirmation to the SAR admin who submitted an org application. Sets the
// expectation that approval is manual (review by an rmdig operator).
export default function SarOrgSubmittedEmail({ orgName }: SarOrgSubmittedEmailProps) {
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
            Because SAR organizations receive safety-of-life alerts, every application is reviewed by
            our team before it&apos;s approved. We&apos;ll email you when there&apos;s a decision or
            if we need anything else from you.
          </Text>
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
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
