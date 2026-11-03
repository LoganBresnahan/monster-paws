ALTER TABLE "keepsake" DROP CONSTRAINT "keepsake_donation_uq";--> statement-breakpoint
ALTER TABLE "keepsake" DROP CONSTRAINT "keepsake_donation_id_donations_id_fk";
--> statement-breakpoint
ALTER TABLE "keepsake" DROP COLUMN "donation_id";--> statement-breakpoint
ALTER TABLE "keepsake" ADD COLUMN "intent_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "keepsake" ADD COLUMN "share_token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "keepsake" ADD CONSTRAINT "keepsake_intent_id_donation_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."donation_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keepsake" ADD CONSTRAINT "keepsake_intent_uq" UNIQUE("intent_id");--> statement-breakpoint
ALTER TABLE "keepsake" ADD CONSTRAINT "keepsake_share_token_uq" UNIQUE("share_token");
