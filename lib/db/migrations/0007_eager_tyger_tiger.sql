CREATE TYPE "public"."ad_creative_action" AS ENUM('submitted', 'approved', 'rejected', 'changes_requested', 'suspended', 'reactivated');--> statement-breakpoint
CREATE TYPE "public"."ad_creative_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."ad_slot" AS ENUM('post_checkin', 'post_checkout', 'loading_idle');--> statement-breakpoint
CREATE TYPE "public"."advertiser_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."advertiser_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" timestamp with time zone,
	"ends_on" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creative_status_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creative_id" uuid NOT NULL,
	"action" "ad_creative_action" NOT NULL,
	"from_status" "ad_creative_status",
	"to_status" "ad_creative_status" NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"slot" "ad_slot" NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"alt_text" text NOT NULL,
	"click_url" text,
	"image_ref" text,
	"forecast_zone_provider" text,
	"forecast_zone_id" text,
	"forecast_zone_set_version" integer,
	"status" "ad_creative_status" DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"avserv_creative_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertiser_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"website_url" text,
	"status" "advertiser_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertiser_memberships" (
	"advertiser_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "advertiser_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by_user_id" uuid,
	CONSTRAINT "advertiser_memberships_advertiser_id_user_id_pk" PRIMARY KEY("advertiser_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative_status_log" ADD CONSTRAINT "ad_creative_status_log_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative_status_log" ADD CONSTRAINT "ad_creative_status_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_accounts" ADD CONSTRAINT "advertiser_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_memberships" ADD CONSTRAINT "advertiser_memberships_advertiser_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_memberships" ADD CONSTRAINT "advertiser_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_memberships" ADD CONSTRAINT "advertiser_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaigns_advertiser_id_idx" ON "ad_campaigns" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "ad_creative_status_log_creative_id_idx" ON "ad_creative_status_log" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "ad_creatives_status_idx" ON "ad_creatives" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_creatives_campaign_id_idx" ON "ad_creatives" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "advertiser_memberships_user_id_idx" ON "advertiser_memberships" USING btree ("user_id");