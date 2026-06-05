ALTER TABLE "users" ADD COLUMN "avserv_account_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avserv_account_id_unique" UNIQUE("avserv_account_id");