import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

// To a SAR team's proposed on-call address (plan 33 9.10). Sent to an inbox
// that may not belong to anyone with a portal account, so it says who asked
// and what confirming does. [COUNSEL]: team-facing wording, for counsel's
// review before a real team.

export interface OncallEmailConfirmEmailProps {
  teamName: string;
  confirmUrl: string;
  expiresInHours: number;
  drill: boolean;
}

export default function OncallEmailConfirmEmail({ teamName, confirmUrl, expiresInHours, drill }: OncallEmailConfirmEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${drill ? "DRILL: " : ""}Confirm the on-call email for ${teamName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          {drill ? <Text style={tag}>DRILL</Text> : null}
          <Heading style={heading}>Confirm your team&apos;s on-call email</Heading>
          <Text style={paragraph}>
            An admin of {teamName} on rmdig asked for AvAI&apos;s search and rescue alerts for the team to be emailed to
            this address. Confirm it only if this inbox belongs to {teamName}.
          </Text>
          <Section style={buttonContainer}>
            <Link href={confirmUrl} style={button}>
              Review and confirm
            </Link>
          </Section>
          <Text style={paragraph}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={confirmUrl} style={link}>
              {confirmUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            This link expires in {expiresInHours} hours. If you don&apos;t know {teamName}, ignore this email: nothing is
            sent here unless the address is confirmed.
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
