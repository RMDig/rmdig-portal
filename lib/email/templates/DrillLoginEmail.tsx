import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

// To a new drill login (plan 37 §4.2), or a drill user with no team (§4.11):
// staff created it, so nobody asked for a reset. The ordinary reset email read as one ("We received a request to
// reset..."), which looked like a fault to the operator on 2026-11-10.

export interface DrillLoginEmailProps {
  /** Null for a drill user, who belongs to no team. */
  teamName: string | null;
  setPasswordUrl: string;
  expiresInMinutes: number;
}

export default function DrillLoginEmail({ teamName, setPasswordUrl, expiresInMinutes }: DrillLoginEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{teamName ? `DRILL: set the password for your ${teamName} login` : "DRILL: set the password for your drill AvAI user"}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={tag}>DRILL</Text>
          <Heading style={heading}>Set your password</Heading>
          {teamName ? (
            <Text style={paragraph}>
              RMDig staff created a drill login for this address on {teamName}, a drill team RMDig uses to test
              AvAI&apos;s search and rescue alerts. It is not a real search and rescue team. Choose a password to sign
              in.
            </Text>
          ) : (
            <Text style={paragraph}>
              RMDig staff created a drill AvAI user for this address, a test account RMDig uses with the DRILL build of
              the AvAI app. It is not a real person&apos;s account. Choose a password to sign in.
            </Text>
          )}
          <Section style={buttonContainer}>
            <Link href={setPasswordUrl} style={button}>
              Set password
            </Link>
          </Section>
          <Text style={paragraph}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={setPasswordUrl} style={link}>
              {setPasswordUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            This link expires in {expiresInMinutes} minutes. After that, use &quot;Forgot password&quot; on the sign-in
            page with this address to get a new one. You&apos;ll set up two-factor sign-in the first time you sign in.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { margin: "40px auto", padding: "32px", backgroundColor: "#ffffff", borderRadius: "8px", maxWidth: "560px" };
const tag = { fontSize: "12px", fontWeight: "700", letterSpacing: "0.08em", color: "#92400e", margin: "0 0 8px" };
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
const link = { color: "#404040", wordBreak: "break-all" as const };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
