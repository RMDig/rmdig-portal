import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export interface SarTermsPendingReviewEmailProps {
  orgName: string;
  reviewUrl: string;
}

// To rmdig admins: a SAR team submitted terms for review (docs/plans/33).
export default function SarTermsPendingReviewEmail({ orgName, reviewUrl }: SarTermsPendingReviewEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{orgName} submitted team terms for review</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Team terms awaiting review</Heading>
          <Text style={paragraph}>
            <strong>{orgName}</strong> submitted terms and the services it provides through AvAI.
            Nothing reaches users until you publish them.
          </Text>
          <Button href={reviewUrl} style={button}>
            Review the terms
          </Button>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an rmdig administrator.</Text>
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
