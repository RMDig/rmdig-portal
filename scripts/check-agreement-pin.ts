import { type CheckMode, checkPath, evaluatePin } from "../lib/agreement/pin-check";
import { PINNED_AGREEMENT } from "../lib/agreement/pinned";
import { askNodes } from "./agreement-nodes";

// CI check (docs/plans/31 §6): the pinned agreement must match what AvServ
// publishes — text, assent line and attestations. Exit 1 on fail; a warning is
// printed as a GitHub Actions annotation and exits 0.
//
//   pnpm agreement:check --mode pr      (ci.yml: unreachable/unpinned only warn)
//   pnpm agreement:check --mode daily   (agreement-pin.yml: both fail)

async function main() {
  const i = process.argv.indexOf("--mode");
  const mode = (i >= 0 ? process.argv[i + 1] : "pr") as CheckMode;
  if (mode !== "pr" && mode !== "daily") {
    console.error("Usage: pnpm agreement:check --mode pr|daily");
    process.exit(2);
  }

  const answers = await askNodes(checkPath(PINNED_AGREEMENT));
  const result = evaluatePin(PINNED_AGREEMENT, answers, mode);

  const prefix = result.outcome === "fail" ? "::error::" : result.outcome === "warn" ? "::warning::" : "";
  for (const m of result.messages) console.log(`${prefix}${m}`);
  process.exit(result.outcome === "fail" ? 1 : 0);
}

main().catch((err) => {
  console.error("::error::agreement check crashed:", err);
  process.exit(1);
});
