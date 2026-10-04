import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export type SarAlertNotifyKind = "overdue" | "send_help" | "all_clear" | "disregard";

export interface SarAlertNotifyEmailProps {
  teamName: string;
  kind: SarAlertNotifyKind;
  /** "Also send help": a user in the team's area who hadn't added the team. */
  fromAreaUser: boolean;
  alertsUrl: string;
}

const HEADLINE: Record<SarAlertNotifyKind, string> = {
  overdue: "Missed check-in alert",
  send_help: "Send Help alert",
  all_clear: "Alert update: resolved",
  disregard: "Alert update: retracted",
};

// To a SAR team's members when AvServ delivers an alert on the portal channel
// (docs/plans/33). Deliberately carries no name, location or note: the
// details are in the portal, where every view is logged.
export default function SarAlertNotifyEmail({ teamName, kind, fromAreaUser, alertsUrl }: SarAlertNotifyEmailProps) {
  const update = kind === "all_clear" || kind === "disregard";
  return (
    <Html>
      <Head />
      <Preview>{`${HEADLINE[kind]} for ${teamName}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{HEADLINE[kind]}</Heading>
          <Text style={paragraph}>
            {update
              ? `An AvAI alert sent to ${teamName} has an update.`
              : fromAreaUser
                ? `An AvAI user in ${teamName}'s area, who hadn't added ${teamName}, chose to send it their Send Help. The details are in the portal.`
                : `An AvAI user who added ${teamName} to their check-out has an alert. The details are in the portal.`}
          </Text>
          <Button href={alertsUrl} style={button}>
            Open your team&apos;s alerts
          </Button>
          <Text style={paragraph}>In an emergency, call 911.</Text>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re a member of {teamName} on rmdig.</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { margin: "40px auto", padding: "32px", backgroundColor: "#ffffff", borderRadius: "8px", maxWidth: "560px" };
const heading = { fontSize: "24px", fontWeight: "600", color: "#171717", margin: "0 0 16px" };
const paragraph = { fontSize: "16px", lineHeight: "24px", color: "#404040", margin: "16px 0" };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
const button = { backgroundColor: "#171717", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", fontSize: "16px", textDecoration: "none" };
