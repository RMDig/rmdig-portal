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

export interface DataDeletionReceivedEmailProps {
  requestId: string;
}

export default function DataDeletionReceivedEmail({
  requestId,
}: DataDeletionReceivedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your data-deletion request is confirmed</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Deletion request confirmed</Heading>
          <Text style={paragraph}>
            Your request to delete the personal data associated with this email address has
            been confirmed and is now in our fulfillment queue.
          </Text>
          <Text style={paragraph}>
            Under the Colorado Privacy Act we will complete your request and reply to this
            address within 45 days. Deletion covers your portal account (if one exists),
            check-out/check-in history, device heartbeat telemetry, capture metadata, and
            emergency-contact details held on our servers (SMS opt-out records are retained as a suppression list so we never re-contact anyone who opted out). Photos you captured with AvAI are
            stored on your device, not our servers — deleting the app or its data removes
            them.
          </Text>
          <Hr style={hr} />
          <Text style={muted}>Request reference: {requestId}</Text>
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
