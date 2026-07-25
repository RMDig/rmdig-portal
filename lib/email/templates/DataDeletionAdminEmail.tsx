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

export interface DataDeletionAdminEmailProps {
  requesterEmail: string;
  requestId: string;
  confirmedAtIso: string;
}

export default function DataDeletionAdminEmail({
  requesterEmail,
  requestId,
  confirmedAtIso,
}: DataDeletionAdminEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Confirmed data-deletion request — CPA 45-day clock running</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Data-deletion request confirmed</Heading>
          <Text style={paragraph}>
            A data-deletion request has been email-confirmed and needs fulfillment. The
            Colorado Privacy Act response window (45 days) started at the confirmation
            timestamp below.
          </Text>
          <Text style={paragraph}>
            Requester: {requesterEmail}
            <br />
            Confirmed at: {confirmedAtIso}
            <br />
            Request reference: {requestId}
          </Text>
          <Text style={paragraph}>
            Fulfillment steps are in docs/runbook.md (&quot;Data-deletion requests&quot;) in
            rmdig-portal. Record completion by setting completed_at + note on the
            deletion_requests row, then reply to the requester.
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you hold the rmdig_admin platform role.
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
