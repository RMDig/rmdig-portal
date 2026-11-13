import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.
//
// To a confirm-first team's admins when someone new is waiting for the team's
// approval (plan 33 9.8; lib/sar/approval-notify.ts). No name and no count:
// the portal learns only that someone is waiting (AvServ sar_terms.md §6a),
// and the names are on the Approvals tab, where each view is logged.

export interface SarApprovalWaitingEmailProps {
  teamName: string;
  approvalsUrl: string;
  drill?: boolean;
}

export default function SarApprovalWaitingEmail({ teamName, approvalsUrl, drill }: SarApprovalWaitingEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${drill ? "[DRILL] " : ""}Someone is waiting for ${teamName} to approve them`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>
            {drill ? "[DRILL] " : ""}Someone is waiting for your team&apos;s approval
          </Heading>
          {drill ? (
            <Text style={paragraph}>
              <strong>This is a drill team.</strong> The person waiting is a drill login, not a real user.
            </Text>
          ) : null}
          <Text style={paragraph}>
            Someone new has accepted <strong>{teamName}</strong>&apos;s terms. Your team approves people first, so they
            can&apos;t name your team on a check-out until one of your admins approves them.
          </Text>
          <Text style={paragraph}>Open Approvals to see who&apos;s waiting and approve or decline them.</Text>
          <Button href={approvalsUrl} style={button}>
            Open Approvals
          </Button>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you&apos;re an admin of {teamName} on rmdig. To stop approving people
            first, change who can name your team on its Check-outs tab.
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
