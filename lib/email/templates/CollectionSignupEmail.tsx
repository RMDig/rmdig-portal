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

export interface CollectionSignupEmailProps {
  name: string;
  email: string;
  phone?: string;
  city: string;
  state: string;
  backcountryExperience: string;
  hasEquipment: boolean;
  dataExperience: string;
  motivation: string;
  submittedAtIso: string;
}

// To rmdig admins only, never the applicant: the portal stores no copy, so
// this email IS the record of the sign-up (runbook "Volunteer sign-ups").
export default function CollectionSignupEmail(p: CollectionSignupEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New snowpack-collection volunteer: {p.name}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>New volunteer sign-up</Heading>
          <Text style={paragraph}>
            Someone signed up at rmdig.ai/collection_signup to help collect snowpack data.
            Reply to them directly at the address below.
          </Text>
          <Text style={paragraph}>
            Name: {p.name}
            <br />
            Email: {p.email}
            <br />
            Phone: {p.phone ?? "(not given)"}
            <br />
            Based in: {`${p.city}, ${p.state}`}
            <br />
            Has shovel, probe, and skis/splitboard with skins: {p.hasEquipment ? "Yes" : "No"}
            <br />
            Submitted at: {p.submittedAtIso}
          </Text>
          <Text style={label}>Backcountry experience</Text>
          <Text style={answer}>{p.backcountryExperience}</Text>
          <Text style={label}>Data, analysis, or AI experience</Text>
          <Text style={answer}>{p.dataExperience}</Text>
          <Text style={label}>Why they want to join</Text>
          <Text style={answer}>{p.motivation}</Text>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you hold the rmdig_admin platform role. This
            email is the only copy of the sign-up; delete it when the applicant asks you to.
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
const label = { fontSize: "14px", fontWeight: "600", color: "#171717", margin: "16px 0 4px" };
const answer = {
  fontSize: "16px",
  lineHeight: "24px",
  color: "#404040",
  margin: "0 0 16px",
  whiteSpace: "pre-wrap" as const,
};
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
