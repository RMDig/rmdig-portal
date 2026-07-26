CREATE TYPE "public"."signup_intent" AS ENUM('explorer', 'sar', 'advertiser');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_intent" "signup_intent";