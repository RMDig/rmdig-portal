import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type SarOrgDecision = "approved" | "rejected" | "changes_requested";

export interface SarOrgDecisionEmailProps {
  orgName: string;
  decision: SarOrgDecision;
  // The operator's note. Required copy for rejected / changes_requested; ignored
  // for approved.
  note?: string;
}

const COPY: Record<SarOrgDecision, { heading: string; preview: string; body: string }> = {
  approved: {
    heading: "Your SAR organization is approved",
    preview: "Your SAR organization application was approved",
    body: "is approved. You can now invite members to your organization and manage its settings.",
  },
  rejected: {
    heading: "Your SAR organization application",
    preview: "An update on your SAR organization application",
    body: "was not approved at this time. See the note below for details.",
  },
  changes_requested: {
    heading: "We need a few changes",
    preview: "Your SAR organization application needs changes",
    body: "needs some changes before we can approve it. See the note below, then update and resubmit.",
  },
};

// One template for all three review outcomes — the copy and whether the note
// block renders are driven by `decision`.
export default function SarOrgDecisionEmail({ orgName, decision, note }: SarOrgDecisionEmailProps) {
  const copy = COPY[decision];
  const showNote = decision !== "approved" && !!note;
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
          {showNote ? (
            <Section style={noteBox}>
              <Text style={noteText}>{note}</Text>
            </Section>
          ) : null}
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you submitted a SAR organization application on rmdig.
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
const noteBox = {
  margin: "16px 0",
  padding: "16px",
  backgroundColor: "#f5f5f5",
  borderRadius: "6px",
  borderLeft: "3px solid #d4d4d4",
};
const noteText = { fontSize: "15px", lineHeight: "22px", color: "#404040", margin: "0", whiteSpace: "pre-wrap" as const };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
