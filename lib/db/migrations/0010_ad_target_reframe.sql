CREATE TYPE "public"."ad_admin_level" AS ENUM('state', 'county', 'place');--> statement-breakpoint
CREATE TYPE "public"."ad_target_kind" AS ENUM('national', 'radius', 'admin');--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_kind" "ad_target_kind" DEFAULT 'national' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_lat" numeric;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_lon" numeric;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_radius_mi" integer;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_admin_level" "ad_admin_level";--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "target_admin_fips" text[];--> statement-breakpoint
ALTER TABLE "ad_creatives" DROP COLUMN "forecast_zone_provider";--> statement-breakpoint
ALTER TABLE "ad_creatives" DROP COLUMN "forecast_zone_id";--> statement-breakpoint
ALTER TABLE "ad_creatives" DROP COLUMN "forecast_zone_set_version";--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_target_shape" CHECK (
        (
          "ad_creatives"."target_kind" = 'national'
          AND "ad_creatives"."target_lat" IS NULL AND "ad_creatives"."target_lon" IS NULL AND "ad_creatives"."target_radius_mi" IS NULL
          AND "ad_creatives"."target_admin_level" IS NULL AND "ad_creatives"."target_admin_fips" IS NULL
        ) OR (
          "ad_creatives"."target_kind" = 'radius'
          AND "ad_creatives"."target_lat" IS NOT NULL AND "ad_creatives"."target_lon" IS NOT NULL
          AND "ad_creatives"."target_radius_mi" IS NOT NULL AND "ad_creatives"."target_radius_mi" BETWEEN 5 AND 250
          AND "ad_creatives"."target_admin_level" IS NULL AND "ad_creatives"."target_admin_fips" IS NULL
        ) OR (
          "ad_creatives"."target_kind" = 'admin'
          AND "ad_creatives"."target_admin_level" IS NOT NULL
          AND "ad_creatives"."target_admin_fips" IS NOT NULL AND array_length("ad_creatives"."target_admin_fips", 1) >= 1
          AND "ad_creatives"."target_lat" IS NULL AND "ad_creatives"."target_lon" IS NULL AND "ad_creatives"."target_radius_mi" IS NULL
        )
      );