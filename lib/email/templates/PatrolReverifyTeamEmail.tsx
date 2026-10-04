import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { ReminderStage } from "../../sar/reverify";

export interface PatrolReverifyTeamEmailProps {
  orgName: string;
  stage: ReminderStage;
  /** The deadline, already formatted for display. */
  reverifyBy: string;
  supportUrl: string;
}

// To a ski patrol's admins: the annual check is coming, or has lapsed
// (lib/sar/reverify.ts). States what happens, never what the patrol must
// provide to anyone else.
export default function PatrolReverifyTeamEmail({ orgName, stage, reverifyBy, supportUrl }: PatrolReverifyTeamEmailProps) {
  const lapsed = stage === "lapsed";
  return (
    <Html>
      <Head />
      <Preview>{lapsed ? `${orgName}'s verification lapsed` : `Annual verification for ${orgName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{lapsed ? "Your patrol's verification lapsed" : "Annual verification for your patrol"}</Heading>
          {lapsed ? (
            <Text style={paragraph}>
              <strong>{orgName}</strong>&apos;s annual verification lapsed on {reverifyBy}. Until AvAI staff re-verify it,
              AvAI doesn&apos;t offer your patrol to users or send it alerts. We&apos;ll call your patrol&apos;s published
              phone number; to arrange it sooner, contact us.
            </Text>
          ) : (
            <Text style={paragraph}>
              AvAI staff check every ski patrol once a year. Before {reverifyBy}, we&apos;ll call{" "}
              <strong>{orgName}</strong>&apos;s published phone number to confirm it still operates. If that number has
              changed, let us know.
            </Text>
          )}
          <Button href={supportUrl} style={button}>
            Contact us
          </Button>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an admin of {orgName} on rmdig.</Text>
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
const button = {
  backgroundColor: "#171717",
  color: "#ffffff",
  padding: "12px 20px",
  borderRadius: "6px",
  fontSize: "16px",
  textDecoration: "none",
};
