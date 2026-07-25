CREATE TYPE "public"."deletion_request_status" AS ENUM('pending_confirmation', 'confirmed', 'completed');--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"status" "deletion_request_status" DEFAULT 'pending_confirmation' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "deletion_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "deletion_requests_status_idx" ON "deletion_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deletion_requests_email_idx" ON "deletion_requests" USING btree ("email");