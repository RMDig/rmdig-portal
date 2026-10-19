import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export interface SecurityNoticeEmailProps {
  /** When the change happened, already formatted for the reader. */
  whenText: string;
  /** /settings/security, where the details are (after a recent sign-in). */
  securityUrl: string;
}

// Opt-in, and deliberately vague (plan 36 §5.3): the inbox may belong to the
// person the account owner is worried about, so the email says only that
// something changed and when. Never what, which phone, or anyone's name.
export default function SecurityNoticeEmail({ whenText, securityUrl }: SecurityNoticeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>A security change on your AvAI account</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>A security change on your account</Heading>
          <Text style={paragraph}>
            A security change happened on your AvAI account at {whenText}. Sign in to see what
            changed.
          </Text>
          <Section style={buttonContainer}>
            <Link href={securityUrl} style={button}>
              Review security activity
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You get these because security notices are turned on for your account. You can turn
            them off in Settings → Security.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { margin: "40px auto", padding: "32px", backgroundColor: "#ffffff", borderRadius: "8px", maxWidth: "560px" };
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
