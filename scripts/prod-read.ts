import postgres from "postgres";

// Read-only production queries from the repo (docs/runbook.md "Read-only
// production access"):
//
//   pnpm prod:read "SELECT status, count(*) FROM sar_orgs GROUP BY 1"
//   pnpm prod:read --json "SELECT …"
//
// Connects as portal_reader through PROD_READ_URL in the gitignored
// .env.prod-read. The role holds SELECT only, with no credential columns
// (scripts/sql/portal-reader-grants.sql); the query also runs in a READ ONLY
// transaction, and the script refuses any other role, so an owner URL pasted
// into the file by mistake can't write.

const READER = "portal_reader";

async function main() {
  const args = process.argv.slice(2);
  const json = args[0] === "--json";
  const query = (json ? args.slice(1) : args).join(" ").trim();
  if (!query) {
    console.error('Usage: pnpm prod:read [--json] "SELECT …"');
    process.exit(2);
  }
  const url = process.env.PROD_READ_URL;
  if (!url) {
    console.error("PROD_READ_URL isn't set: put it in .env.prod-read (docs/runbook.md \"Read-only production access\").");
    process.exit(2);
  }
  const user = decodeURIComponent(new URL(url).username);
  if (user !== READER) {
    console.error(`PROD_READ_URL connects as ${user}, not ${READER}. Refusing: this script only reads.`);
    process.exit(2);
  }

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  try {
    const rows = await sql.begin("read only", async (tx) => {
      const [who] = await tx<{ u: string }[]>`SELECT current_user AS u`;
      if (who?.u !== READER) throw new Error(`Connected as ${who?.u ?? "unknown"}, not ${READER}.`);
      return tx.unsafe(query);
    });
    if (json) console.log(JSON.stringify(rows, null, 2));
    else if (rows.length === 0) console.log("(no rows)");
    else console.table(rows);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
