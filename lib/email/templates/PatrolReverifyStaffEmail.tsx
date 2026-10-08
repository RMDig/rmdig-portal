import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { ReminderStage } from "../../sar/reverify";

export interface PatrolReverifyStaffEmailProps {
  orgName: string;
  stage: ReminderStage;
  /** The deadline, already formatted for display. */
  reverifyBy: string;
  contactPhone: string | null;
  reviewUrl: string;
}

// To rmdig admins: a ski patrol's annual re-verification is due or has lapsed
// (lib/sar/reverify.ts). Staff call the patrol's published number, then mark
// it re-verified on the approvals page.
export default function PatrolReverifyStaffEmail({ orgName, stage, reverifyBy, contactPhone, reviewUrl }: PatrolReverifyStaffEmailProps) {
  const lapsed = stage === "lapsed";
  return (
    <Html>
      <Head />
      <Preview>{lapsed ? `${orgName}: verification lapsed` : `Re-verify ${orgName} by ${reverifyBy}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{lapsed ? `${orgName}: verification lapsed` : `Re-verify ${orgName} by ${reverifyBy}`}</Heading>
          <Text style={paragraph}>
            {lapsed
              ? `The patrol's annual verification lapsed on ${reverifyBy}. AvAI doesn't use the patrol until it's re-verified.`
              : "Call the patrol's published phone number to confirm it still operates, then mark it re-verified on the approvals page."}
          </Text>
          <Text style={paragraph}>
            Number on file: {contactPhone ?? "none"}. Check it against the patrol&apos;s own published listing before calling.
          </Text>
          <Button href={reviewUrl} style={button}>
            Open SAR approvals
          </Button>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an rmdig SAR approver.</Text>
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
