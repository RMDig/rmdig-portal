import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export interface RestrictionReviewRequestedEmailProps {
  reviewUrl: string;
}

// To rmdig staff: a user asked for a review of a feature restriction (plan
// 38/39). Carries nothing about the user or their message (which is never
// logged either); the details are behind sign-in.
export default function RestrictionReviewRequestedEmail({ reviewUrl }: RestrictionReviewRequestedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>A restriction review is waiting</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>A restriction review is waiting</Heading>
          <Text style={paragraph}>A user asked us to review a restriction on their account.</Text>
          <Button href={reviewUrl} style={button}>
            Open the review
          </Button>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you review restrictions on rmdig.</Text>
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
