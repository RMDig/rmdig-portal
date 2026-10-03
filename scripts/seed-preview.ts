import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  advertiserAccounts,
  advertiserMemberships,
  orgMemberships,
  sarOrgs,
  userPlatformRoles,
  users,
} from "../lib/db/schema";
import { isProductionDatabaseUrl } from "../lib/preview-guard";
import { parseSeedArgs, previewPersonas, SeedPassword } from "../lib/preview-seed";

// Seed the preview Neon project's `preview-seed` branch with test personas
// (runbook "Preview deployments"). Run against that branch only, after
// migrating it:
//
//   PREVIEW_SEED_DATABASE_URL=<preview-seed URL> PREVIEW_SEED_PASSWORD=<pw> \
//     pnpm db:seed-preview you@example.com [--admin you@work.example]
//
// Takes its own variable, not DATABASE_URL, so it can't pick up whatever
// .env.local points at, and refuses the production endpoint outright.
// Idempotent: re-running leaves existing rows alone.
loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.PREVIEW_SEED_DATABASE_URL;
  let args: ReturnType<typeof parseSeedArgs>;
  try {
    if (!url) throw new Error("PREVIEW_SEED_DATABASE_URL is not set");
    args = parseSeedArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}
Usage: PREVIEW_SEED_DATABASE_URL=<url> PREVIEW_SEED_PASSWORD=<pw> pnpm db:seed-preview <your email> [--admin <email>]...`);
    process.exit(1);
  }
  if (isProductionDatabaseUrl(url)) {
    console.error("Refusing to seed: PREVIEW_SEED_DATABASE_URL is the production endpoint.");
    process.exit(1);
  }

  const personas = previewPersonas(args.base);
  const passwordHash = await bcrypt.hash(SeedPassword.parse(process.env.PREVIEW_SEED_PASSWORD), 12);

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);
  try {
    const ids = new Map<string, string>();
    for (const p of personas) {
      await db
        .insert(users)
        .values({
          email: p.email,
          name: p.name,
          displayName: p.name,
          passwordHash,
          emailVerified: new Date(),
          signupIntent: p.tag === "sar" ? "sar" : p.tag === "advertiser" ? "advertiser" : "explorer",
        })
        .onConflictDoNothing();
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.email));
      if (!row) throw new Error(`seed: ${p.email} missing after insert`);
      ids.set(p.tag, row.id);
    }
    const id = (tag: string) => ids.get(tag)!;

    await db
      .insert(userPlatformRoles)
      .values({ userId: id("admin"), role: "rmdig_admin" })
      .onConflictDoNothing();

    // An approved test org, so the SAR persona sees the org dashboard. Approval
    // is a direct insert on a test branch: there is no real org to verify (§0
    // governs production, where approval only happens in the operator queue).
    const sarEmail = personas.find((p) => p.tag === "sar")!.email;
    let [org] = await db.select({ id: sarOrgs.id }).from(sarOrgs).where(eq(sarOrgs.contactEmail, sarEmail));
    if (!org) {
      [org] = await db
        .insert(sarOrgs)
        .values({
          name: "Preview Test SAR (not a real team)",
          regionName: "Test region",
          contactName: "Preview SAR Lead",
          contactEmail: sarEmail,
          operatingStatus: "volunteer_group",
          proofDocUrl: "https://example.invalid/preview-seed-proof.pdf",
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: id("admin"),
          createdByUserId: id("sar"),
        })
        .returning({ id: sarOrgs.id });
    }
    await db
      .insert(orgMemberships)
      .values({ orgId: org!.id, userId: id("sar"), role: "admin" })
      .onConflictDoNothing();

    const advEmail = personas.find((p) => p.tag === "advertiser")!.email;
    let [adv] = await db
      .select({ id: advertiserAccounts.id })
      .from(advertiserAccounts)
      .where(eq(advertiserAccounts.contactEmail, advEmail));
    if (!adv) {
      [adv] = await db
        .insert(advertiserAccounts)
        .values({
          name: "Preview Test Advertiser",
          contactName: "Preview Advertiser",
          contactEmail: advEmail,
          createdByUserId: id("advertiser"),
        })
        .returning({ id: advertiserAccounts.id });
    }
    await db
      .insert(advertiserMemberships)
      .values({ advertiserId: adv!.id, userId: id("advertiser"), role: "admin" })
      .onConflictDoNothing();

    for (const email of args.extraAdmins) {
      await db
        .insert(users)
        .values({
          email,
          name: "Preview Admin",
          displayName: "Preview Admin",
          passwordHash,
          emailVerified: new Date(),
          signupIntent: "explorer",
        })
        .onConflictDoNothing();
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (!row) throw new Error(`seed: ${email} missing after insert`);
      await db.insert(userPlatformRoles).values({ userId: row.id, role: "rmdig_admin" }).onConflictDoNothing();
    }

    for (const p of personas) console.log(`✓ ${p.tag.padEnd(10)} ${p.email}`);
    for (const email of args.extraAdmins) console.log(`✓ ${"admin".padEnd(10)} ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
