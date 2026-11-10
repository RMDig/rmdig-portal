import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface SarAreaChangedEmailProps {
  orgName: string;
  editorEmail: string;
  /** Null when the team had no area before. */
  fromAreaKm2: number | null;
  toAreaKm2: number;
  orgUrl: string;
}

const km2 = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)} km²`;

// Informational notice to SAR approvers that a team changed its own service
// area (plan 33 D3, step 9.4). Nothing to approve: the edit is already live
// and synced; this is so staff can see it and suspend a team if needed.
export default function SarAreaChangedEmail({ orgName, editorEmail, fromAreaKm2, toAreaKm2, orgUrl }: SarAreaChangedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{orgName} changed its service area</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>A team changed its service area</Heading>
          <Text style={paragraph}>
            {editorEmail} changed the service area of <strong>{orgName}</strong>
            {fromAreaKm2 === null ? ` to ${km2(toAreaKm2)}.` : ` from ${km2(fromAreaKm2)} to ${km2(toAreaKm2)}.`}
          </Text>
          <Text style={paragraph}>
            The change is already saved and sent to AvServ. Nothing needs approving; the team&apos;s page shows the new
            area.
          </Text>
          <Section style={buttonContainer}>
            <Link href={orgUrl} style={button}>
              Open the team in the approvals queue
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you review search &amp; rescue teams on rmdig.
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
const buttonContainer = { textAlign: "center" as const, margin: "32px 0" };
const button = {
  display: "inline-block",
  padding: "12px 24px",
  backgroundColor: "#171717",
  color: "#ffffff",
  borderRadius: "6px",
  fontSize: "16px",
  fontWeight: "500",
  textDecoration: "none",
};
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
