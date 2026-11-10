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

export type SarTeamStatusChange = "suspended" | "reactivated";

export interface SarTeamStatusEmailProps {
  orgName: string;
  change: SarTeamStatusChange;
  supportUrl: string;
}

// To a team's admins when rmdig staff suspend it or move it back to review
// (plan 33 §6.4, step 9.13). Says what AvAI does for the team now; the staff
// note stays in the status log, since it can record why.
const COPY: Record<SarTeamStatusChange, { heading: string; preview: string; body: string }> = {
  suspended: {
    heading: "Your team is suspended",
    preview: "Your team is suspended on AvAI",
    body: "is suspended. While it is, AvAI doesn't offer your team to anyone and doesn't send it alerts, including for check-outs that already named your team.",
  },
  reactivated: {
    heading: "Your team is back under review",
    preview: "Your team is back under review",
    body: "is no longer suspended and is back under review. AvAI still doesn't offer your team or send it alerts until rmdig staff approve it again. We'll email you when there's a decision.",
  },
};

export default function SarTeamStatusEmail({ orgName, change, supportUrl }: SarTeamStatusEmailProps) {
  const copy = COPY[change];
  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{copy.heading}</Heading>
          <Text style={paragraph}>
            <strong>{orgName}</strong> {copy.body}
          </Text>
          <Section style={buttonContainer}>
            <Link href={supportUrl} style={button}>
              Contact rmdig support
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an admin of this team on rmdig.</Text>
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
