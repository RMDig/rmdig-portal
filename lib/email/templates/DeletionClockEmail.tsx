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

// The daily reminder (lib/deletion/clock.ts) for confirmed data-deletion
// requests that are 30 or more days into the Colorado Privacy Act's 45-day
// window. Lists request references only; the requester's address stays on
// the queue page.

export interface DeletionClockItem {
  requestId: string;
  confirmedAtIso: string;
  dueIso: string;
  /** Days left before the 45-day deadline; 0 or less means it has passed. */
  daysLeft: number;
}

export interface DeletionClockEmailProps {
  /** True once any request is 40 or more days in. */
  escalated: boolean;
  items: DeletionClockItem[];
  /** Admin → Deletion requests. */
  queueUrl: string;
}

function left(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} past the deadline`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export default function DeletionClockEmail({ escalated, items, queueUrl }: DeletionClockEmailProps) {
  const heading = escalated ? "Data-deletion requests near their deadline" : "Data-deletion requests waiting 30+ days";
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading_}>{heading}</Heading>
          <Text style={paragraph}>
            {items.length === 1 ? "This confirmed request has" : "These confirmed requests have"} not been
            marked completed. The Colorado Privacy Act gives 45 days from confirmation to respond.
          </Text>
          {items.map((i) => (
            <Text key={i.requestId} style={paragraph}>
              Request reference: {i.requestId}
              <br />
              Confirmed at: {i.confirmedAtIso}
              <br />
              Due by: {i.dueIso} ({left(i.daysLeft)})
            </Text>
          ))}
          <Text style={paragraph}>
            Fulfillment steps are in docs/runbook.md (&quot;Data-deletion requests&quot;) in
            rmdig-portal. Mark each request completed on the queue when it&apos;s done; this reminder
            repeats daily until then.
          </Text>
          <Section style={buttonContainer}>
            <Link href={queueUrl} style={button}>
              Open the deletion queue
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>
            You&apos;re receiving this because you hold the rmdig_admin platform role.
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
const heading_ = { fontSize: "24px", fontWeight: "600", color: "#171717", margin: "0 0 16px" };
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
