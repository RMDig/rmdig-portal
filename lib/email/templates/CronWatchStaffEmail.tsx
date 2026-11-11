import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export interface CronWatchStaffEmailProps {
  jobs: Array<{ path: string; dueAt: string; lastSuccessAt: string | null }>;
}

// Daily, to rmdig admins, while a scheduled job hasn't run (lib/cron/watch.ts).
// Times are UTC, as in vercel.json and the runbook's job table.
export default function CronWatchStaffEmail({ jobs }: CronWatchStaffEmailProps) {
  const one = jobs.length === 1;
  return (
    <Html>
      <Head />
      <Preview>{one ? "A scheduled job didn't run" : `${jobs.length} scheduled jobs didn't run`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{one ? "A scheduled job didn't run" : "Scheduled jobs didn't run"}</Heading>
          <Text style={paragraph}>
            {one ? "This job hasn't" : "These jobs haven't"} finished successfully since {one ? "its" : "their"} last scheduled
            run:
          </Text>
          {jobs.map((j) => (
            <Text key={j.path} style={item}>
              <strong>{j.path}</strong>: due {utc(j.dueAt)}; last success {j.lastSuccessAt ? utc(j.lastSuccessAt) : "never recorded"}
            </Text>
          ))}
          <Text style={paragraph}>
            Check Vercel → Cron Jobs and the job&apos;s logs. A lost CRON_SECRET, a dropped vercel.json entry or a broken
            deploy stops a job without an error. The runbook&apos;s &quot;Scheduled jobs&quot; section says what each job
            does. This email repeats each day while it lasts.
          </Text>
          <Hr style={hr} />
          <Text style={muted}>You&apos;re receiving this because you&apos;re an rmdig admin.</Text>
        </Container>
      </Body>
    </Html>
  );
}

function utc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

const body = { backgroundColor: "#fafafa", fontFamily: "Helvetica, Arial, sans-serif" };
const container = { margin: "40px auto", padding: "32px", backgroundColor: "#ffffff", borderRadius: "8px", maxWidth: "560px" };
const heading = { fontSize: "24px", fontWeight: "600", color: "#171717", margin: "0 0 16px" };
const paragraph = { fontSize: "16px", lineHeight: "24px", color: "#404040", margin: "16px 0" };
const item = { fontSize: "15px", lineHeight: "22px", color: "#171717", margin: "4px 0" };
const hr = { borderColor: "#e5e5e5", margin: "32px 0" };
const muted = { fontSize: "14px", lineHeight: "20px", color: "#737373" };
