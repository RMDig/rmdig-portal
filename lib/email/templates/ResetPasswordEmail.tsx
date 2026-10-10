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

export interface ResetPasswordEmailProps {
  resetUrl: string;
  expiresInMinutes: number;
}

export default function ResetPasswordEmail({
  resetUrl,
  expiresInMinutes,
}: ResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your rmdig password</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Reset your password</Heading>
          <Text style={paragraph}>
            We received a request to reset the password on your rmdig account. Click the button
            below to choose a new one. If you sign in with Google, this adds a password you can
            use as well.
          </Text>
          <Section style={buttonContainer}>
            <Link href={resetUrl} style={button}>
              Reset password
            </Link>
          </Section>
          <Text style={paragraph}>
            Or copy and paste this URL into your browser:{" "}
            <Link href={resetUrl} style={link}>
              {resetUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={muted}>
            This link expires in {expiresInMinutes} minutes. If you didn&apos;t request a
            password reset, you can safely ignore this email — your password won&apos;t change.
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
