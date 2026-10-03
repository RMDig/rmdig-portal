"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { createAnnouncementSchema } from "@/lib/announcements/announcements";
import { auth } from "@/lib/auth";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { announcementLog, announcements } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// Staff announcements (docs/runbook.md "Announcements"). rmdig_admin only.
// Every create and end writes the announcement_log row in the same
// transaction, so the history can't drift from the table.

export type AnnouncementResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

async function adminId(): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id || !(await hasPlatformRole(id, "rmdig_admin"))) return null;
  return id;
}

export async function createAnnouncementAction(
  _prev: AnnouncementResult | null,
  formData: FormData,
): Promise<AnnouncementResult> {
  const actor = await adminId();
  if (!actor) return { ok: false, error: "Only a platform administrator can post announcements." };

  const parsed = createAnnouncementSchema.safeParse({
    message: formData.get("message") ?? "",
    severity: formData.get("severity"),
    audiences: formData.getAll("audiences"),
    startsAt: formData.get("startsAt") ?? undefined,
    endsAt: formData.get("endsAt") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({
          message: v.message,
          severity: v.severity,
          audiences: v.audiences,
          startsAt: v.startsAt ?? null,
          endsAt: v.endsAt ?? null,
          createdByUserId: actor,
        })
        .returning({ id: announcements.id });
      await tx.insert(announcementLog).values({ announcementId: row!.id, action: "created", actorUserId: actor });
    });
  } catch (err) {
    logger.error({ event: "announcements.create_failed", actor, err });
    return { ok: false, error: "Couldn't save the announcement. Try again." };
  }
  logger.info({ event: "announcements.created", actor, severity: v.severity, audiences: v.audiences });
  revalidatePath("/admin/announcements");
  return { ok: true };
}

export async function endAnnouncementAction(formData: FormData): Promise<void> {
  const actor = await adminId();
  if (!actor) throw new Error("Only a platform administrator can end announcements.");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Unknown announcement.");

  const ended = await db.transaction(async (tx) => {
    const rows = await tx
      .update(announcements)
      .set({ endedAt: new Date() })
      .where(and(eq(announcements.id, id), isNull(announcements.endedAt)))
      .returning({ id: announcements.id });
    if (rows.length > 0) {
      await tx.insert(announcementLog).values({ announcementId: id, action: "ended", actorUserId: actor });
    }
    return rows.length > 0;
  });
  logger.info({ event: ended ? "announcements.ended" : "announcements.end_noop", actor, id });
  revalidatePath("/admin/announcements");
}
