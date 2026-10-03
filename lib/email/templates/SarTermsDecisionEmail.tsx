import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export type SarTermsDecision = "published" | "rejected";

export interface SarTermsDecisionEmailProps {
  orgName: string;
  decision: SarTermsDecision;
  version?: number;
  note?: string;
}

// To a SAR team's admins: their submitted terms were published or sent back.
export default function SarTermsDecisionEmail({ orgName, decision, version, note }: SarTermsDecisionEmailProps) {
  const published = decision === "published";
  return (
    <Html>
      <Head />
      <Preview>{published ? `Your team terms are published` : `Your team terms need changes`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{published ? "Team terms published" : "Team terms need changes"}</Heading>
          <Text style={paragraph}>
            {published
              ? `Version ${version} of the terms for ${orgName} is published.`
              : `We couldn't publish the terms ${orgName} submitted.`}
          </Text>
          {!published && note ? (
            <Text style={paragraph}>
              <strong>What to change:</strong> {note}
            </Text>
          ) : null}
          <Text style={paragraph}>You can see them on your team&apos;s Terms page in the portal.</Text>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an admin of {orgName}.</Text>
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
