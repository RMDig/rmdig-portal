import { lookupAccountsByEmail } from "./account-lookup";
import { describeHealthCheck, readNodeHealth } from "./node-health";
import { AvServError } from "./request";
import { readRedFeed } from "./sar-feeds";
import { ackSarAlert, avservNodes, getSarTeam, type AvServNode } from "./sar-teams";
import { readShareLog } from "./share-log";

// Admin → AvServ checks: one harmless call per portal feature to every node,
// through the same client code the features use, to prove the node has the
// route and our service key has its route group. Made-up ids reach nothing,
// so nothing is written on AvServ; the email lookup records only a hash of the
// probe address, with the admin as reader. A 403 means the key lacks the
// group on that node.

const NONE = "00000000-0000-4000-8000-000000000000";
export const PROBE_EMAIL = "probe@example.com";

export interface CheckResult {
  check: string;
  group: string;
  node: string;
  ok: boolean;
  /** What the node answered, in AvServ's words (a code, or "ok"). */
  answer: string;
  /** Not a failure but worth a look: a node-health check AvServ marks warn
   *  (low disk, a stale cleanup) or can't read (unknown). */
  warn?: boolean;
}

const HEALTH_GROUP = "node_health";

/** Node health as rows: the overall verdict, then one row per check (disk
 *  headroom, the daily cleanup). A call that fails is one failed row. */
async function nodeHealthRows(node: AvServNode): Promise<CheckResult[]> {
  const r = await readNodeHealth(node);
  const row = (check: string, status: string, answer: string): CheckResult => ({
    check,
    group: HEALTH_GROUP,
    node: node.name,
    ok: status === "ok",
    warn: status === "warn" || status === "unknown",
    answer,
  });
  if (!r.ok) return [{ check: "Node health", group: HEALTH_GROUP, node: node.name, ok: false, answer: r.code }];
  return [
    row("Node health", r.health.status, r.health.status),
    ...r.health.checks.map((c) => row(c.label, c.status, describeHealthCheck(c))),
  ];
}

type Probe = { check: string; group: string; run: (node: AvServNode, reader: string) => Promise<{ ok: boolean; answer: string }> };

const PROBES: Probe[] = [
  {
    check: "Team sync",
    group: "sar_sync",
    run: async (node) => {
      try {
        const view = await getSarTeam(node, NONE);
        return { ok: true, answer: view ? "ok" : "sar_team_unknown (expected)" };
      } catch (err) {
        return { ok: false, answer: err instanceof AvServError && err.status ? `http_${err.status}` : codeOf(err) };
      }
    },
  },
  {
    check: "Red alerts feed",
    group: "sar_feed",
    run: async (node, reader) => {
      const r = await readRedFeed(node, NONE, reader);
      return r.ok ? { ok: true, answer: "ok" } : { ok: r.code === "sar_team_unknown", answer: expected(r.code, "sar_team_unknown") };
    },
  },
  {
    check: "Mark received",
    group: "sar_ack",
    run: async (node, reader) => {
      const r = await ackSarAlert(node, `${NONE}:${NONE}`, { teamId: NONE, by: `portal-user:${reader}` });
      return r.ok ? { ok: true, answer: "ok" } : { ok: r.code === "sar_alert_unknown", answer: expected(r.code, "sar_alert_unknown") };
    },
  },
  {
    check: "Deletion lookup",
    group: "sar_feed",
    run: async (node) => {
      const r = await readShareLog(node, NONE);
      return r.ok ? { ok: true, answer: `ok (${r.items.length} rows)` } : { ok: false, answer: r.code };
    },
  },
  {
    check: "Email lookup",
    group: "account_lookup",
    run: async (node, reader) => {
      const r = await lookupAccountsByEmail(node, PROBE_EMAIL, reader);
      return r.ok ? { ok: true, answer: `ok (${r.matches.length} matches)` } : { ok: false, answer: r.code };
    },
  },
];

function expected(code: string, want: string): string {
  return code === want ? `${code} (expected)` : code;
}

function codeOf(err: unknown): string {
  return err instanceof AvServError && err.code ? err.code : err instanceof Error ? err.message : String(err);
}

/** Every probe on every configured node, in parallel, then each node's health.
 *  Never throws for a node's answer; a probe that throws (e.g. a signing-key
 *  fault) is reported as such.
 *  The daily cron leaves out the email lookup, the one probe AvServ logs. */
export async function runAvServChecks(readerUserId: string, opts: { emailLookup?: boolean } = {}): Promise<CheckResult[]> {
  const nodes = avservNodes();
  const probes = opts.emailLookup === false ? PROBES.filter((p) => p.group !== "account_lookup") : PROBES;
  const runs = nodes.flatMap((node) =>
    probes.map(async (p): Promise<CheckResult[]> => {
      try {
        const r = await p.run(node, readerUserId);
        return [{ check: p.check, group: p.group, node: node.name, ...r }];
      } catch (err) {
        return [{ check: p.check, group: p.group, node: node.name, ok: false, answer: codeOf(err) }];
      }
    }),
  );
  const health = nodes.map((node) =>
    nodeHealthRows(node).catch((err): CheckResult[] => [
      { check: "Node health", group: HEALTH_GROUP, node: node.name, ok: false, answer: codeOf(err) },
    ]),
  );
  return (await Promise.all([...runs, ...health])).flat();
}
