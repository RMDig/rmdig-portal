import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export interface SarLeavingStaffEmailProps {
  orgName: string;
  actorEmail: string;
  change: "give_notice" | "undo";
  orgUrl: string;
}

// Informational notice to SAR approvers that a team gave its own leaving
// notice, or undid it (plan 33 §6.9). Nothing to approve: it's saved and sent
// to AvServ. A leaving team is withdrawn by staff once no check-out is bound.
export default function SarLeavingStaffEmail({ orgName, actorEmail, change, orgUrl }: SarLeavingStaffEmailProps) {
  const notice = change === "give_notice";
  return (
    <Html>
      <Head />
      <Preview>{notice ? `${orgName} is leaving AvAI` : `${orgName} undid its leaving notice`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{notice ? "A team gave its leaving notice" : "A team undid its leaving notice"}</Heading>
          <Text style={paragraph}>
            {actorEmail} {notice ? "gave the leaving notice for" : "undid the leaving notice for"} <strong>{orgName}</strong>.
          </Text>
          <Text style={paragraph}>
            {notice
              ? "AvAI no longer offers the team or binds new check-outs to it. Check-outs already bound keep it until each ends. Withdraw the team once no node reports one bound."
              : "The team is active again, and AvAI offers it to users as before."}
          </Text>
          <Section style={buttonContainer}>
            <Link href={orgUrl} style={button}>
              Open the team
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you review search &amp; rescue teams on rmdig.</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "40px auto", padding: "32px", maxWidth: "560px", borderRadius: "8px" };
const heading = { fontSize: "20px", fontWeight: 600, margin: "0 0 16px" };
const paragraph = { fontSize: "15px", lineHeight: "24px", color: "#1f2937" };
const buttonContainer = { margin: "24px 0" };
const button = { backgroundColor: "#111827", color: "#ffffff", padding: "10px 18px", borderRadius: "6px", textDecoration: "none", fontSize: "14px" };
const hr = { borderColor: "#e5e7eb", margin: "24px 0" };
const muted = { fontSize: "12px", color: "#6b7280" };
