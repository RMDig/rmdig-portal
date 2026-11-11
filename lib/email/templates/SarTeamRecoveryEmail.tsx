import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { Remedy } from "../../avserv/sar-teams";
import { REMEDY_COPY, waitingText } from "../../sar/recovery-rules";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.
//
// To a team's admins when an AvAI server reports it can't send the team
// alerts, with what fixes it and what the server is holding back (plan 33
// §6.9 F4). Once per new problem per server (lib/sar/recovery.ts).

export interface SarTeamRecoveryEmailProps {
  teamName: string;
  nodes: Array<{ node: string; remedy: Remedy; waitingAlerts: number | null }>;
  teamUrl: string;
}

export default function SarTeamRecoveryEmail({ teamName, nodes, teamUrl }: SarTeamRecoveryEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`AvAI can't send ${teamName} alerts from ${nodes.length === 1 ? "one server" : `${nodes.length} servers`}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>AvAI can&apos;t send your team alerts from {nodes.length === 1 ? "one server" : "some servers"}</Heading>
          <Text style={paragraph}>
            AvAI runs on more than one server. {nodes.length === 1 ? "One of them reports" : "Some of them report"} that it
            can&apos;t send <strong>{teamName}</strong> alerts until this is fixed:
          </Text>
          {nodes.map((n) => (
            <Text key={n.node} style={paragraph}>
              <strong>{n.node}:</strong> {REMEDY_COPY[n.remedy].text}
              {n.waitingAlerts ? ` ${waitingText(n.waitingAlerts)}` : ""}
            </Text>
          ))}
          <Button href={teamUrl} style={button}>
            Open your team in the portal
          </Button>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you&apos;re an admin of {teamName} on rmdig. In an emergency, call 911.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "40px auto", padding: "32px", maxWidth: "560px", borderRadius: "8px" };
const heading = { fontSize: "20px", fontWeight: 600, margin: "0 0 16px" };
const paragraph = { fontSize: "15px", lineHeight: "24px", color: "#1f2937" };
const button = { backgroundColor: "#111827", color: "#ffffff", padding: "10px 18px", borderRadius: "6px", textDecoration: "none", fontSize: "14px" };
const hr = { borderColor: "#e5e7eb", margin: "24px 0" };
const muted = { fontSize: "12px", color: "#6b7280" };
