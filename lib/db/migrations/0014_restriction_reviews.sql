CREATE TYPE "public"."restriction_review_action" AS ENUM('submitted', 'upheld', 'lifted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."restriction_review_status" AS ENUM('open', 'upheld', 'lifted', 'closed');--> statement-breakpoint
CREATE TABLE "restriction_review_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" "restriction_review_action" NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restriction_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"avserv_account_id" uuid NOT NULL,
	"restriction_id" uuid NOT NULL,
	"submission_key" uuid NOT NULL,
	"message" text NOT NULL,
	"status" "restriction_review_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_note" text,
	CONSTRAINT "restriction_review_requests_submission_key_unique" UNIQUE("submission_key")
);
--> statement-breakpoint
ALTER TABLE "restriction_review_log" ADD CONSTRAINT "restriction_review_log_request_id_restriction_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."restriction_review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restriction_review_log" ADD CONSTRAINT "restriction_review_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restriction_review_requests" ADD CONSTRAINT "restriction_review_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restriction_review_requests" ADD CONSTRAINT "restriction_review_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "restriction_review_log_request_id_idx" ON "restriction_review_log" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restriction_review_requests_one_open" ON "restriction_review_requests" USING btree ("restriction_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "restriction_review_requests_status_created_idx" ON "restriction_review_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "restriction_review_requests_user_id_idx" ON "restriction_review_requests" USING btree ("user_id");