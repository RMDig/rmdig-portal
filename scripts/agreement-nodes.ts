import { AgreementVersionSchema, type NodeAnswer } from "../lib/agreement/pin-check";

// Shared by scripts/pin-agreement.ts and scripts/check-agreement-pin.ts: ask
// AvServ's public agreement endpoint (contract account_agreement.md §2 — no
// auth) on each node in turn. Nodes come from AGREEMENT_CHECK_NODES (the CI
// workflows set it); the default is the two production nodes.

const DEFAULT_NODES = ["https://avserv-2.rmdig.ai", "https://avserv-3.rmdig.ai"];
const TIMEOUT_MS = 10_000;

export function agreementNodes(): string[] {
  const raw = process.env.AGREEMENT_CHECK_NODES;
  const nodes = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_NODES;
  return nodes.map((n) => n.replace(/\/$/, ""));
}

export async function askNode(node: string, path: string): Promise<NodeAnswer> {
  let res: Response;
  try {
    res = await fetch(`${node}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { node, kind: "unreachable", message: (err as Error).message };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = AgreementVersionSchema.safeParse(json);
    if (!parsed.success) {
      // A 200 we can't read is a contract break, not an outage: report it as an
      // authoritative failure so the check fails instead of warning.
      return { node, kind: "http", status: 422, code: "response_schema_invalid" };
    }
    return { node, kind: "ok", body: parsed.data };
  }
  const code =
    json && typeof json === "object" && "code" in json && typeof json.code === "string"
      ? json.code
      : undefined;
  return { node, kind: "http", status: res.status, code };
}

/** Ask every node (in order) and return all answers; the caller picks. */
export async function askNodes(path: string): Promise<NodeAnswer[]> {
  const answers: NodeAnswer[] = [];
  for (const node of agreementNodes()) {
    const a = await askNode(node, path);
    answers.push(a);
    if (a.kind === "ok" || (a.kind === "http" && a.status < 500)) break;
  }
  return answers;
}
