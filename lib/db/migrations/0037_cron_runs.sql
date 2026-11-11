CREATE TABLE "cron_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"watched_since" timestamp with time zone DEFAULT now() NOT NULL
);
