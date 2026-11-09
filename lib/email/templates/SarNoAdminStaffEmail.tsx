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

export interface SarNoAdminStaffEmailProps {
  teams: Array<{ name: string; status: string }>;
  queueUrl: string;
}

// Daily, to SAR approvers, while any live team has no admin (plan 33 §6.4,
// step 9.13). The members page stops a team removing its last admin, but an
// account deletion can still leave none, and then nobody can manage it.
export default function SarNoAdminStaffEmail({ teams, queueUrl }: SarNoAdminStaffEmailProps) {
  const one = teams.length === 1;
  return (
    <Html>
      <Head />
      <Preview>{one ? "A SAR team has no admin" : `${teams.length} SAR teams have no admin`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{one ? "A SAR team has no admin" : "SAR teams with no admin"}</Heading>
          <Text style={paragraph}>
            {one ? "This team has" : "These teams have"} no admin, so nobody can manage {one ? "its" : "their"} members,
            terms or service area:
          </Text>
          {teams.map((t) => (
            <Text key={t.name} style={item}>
              <strong>{t.name}</strong> ({t.status})
            </Text>
          ))}
          <Text style={paragraph}>
            Add an admin, or decide what happens to the team. This email repeats each day while it lasts.
          </Text>
          <Section style={buttonContainer}>
            <Link href={queueUrl} style={button}>
              Open SAR approvals
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you review search &amp; rescue teams on rmdig.</Text>
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
const item = { fontSize: "16px", lineHeight: "24px", color: "#404040", margin: "4px 0 4px 16px" };
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
