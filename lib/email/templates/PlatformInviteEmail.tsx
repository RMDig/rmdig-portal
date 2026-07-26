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

export interface PlatformInviteEmailProps {
  inviteUrl: string;
  roleLabel: string;
  expiresInDays: number;
}

export default function PlatformInviteEmail({
  inviteUrl,
  roleLabel,
  expiresInDays,
}: PlatformInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You&apos;ve been invited to the rmdig staff team</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>rmdig staff invitation</Heading>
          <Text style={paragraph}>
            You&apos;ve been invited to join the rmdig platform team as{" "}
            <strong>{roleLabel}</strong>. Accept with the button below — you&apos;ll need to
            sign in (or create an account) with this email address, and two-factor
            authentication is required for staff accounts.
          </Text>
          <Section style={buttonContainer}>
            <Link href={inviteUrl} style={button}>
              Accept invitation
            </Link>
          </Section>
          <Text style={paragraph}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            This invitation expires in {expiresInDays} days and can be used once. If you
            weren&apos;t expecting it, ignore this email — nothing is granted without this
            link.
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
const link = { color: "#404040", wordBreak: "break-all" as const };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
