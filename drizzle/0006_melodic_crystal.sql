DROP INDEX "animals_status_created_idx";--> statement-breakpoint
DROP INDEX "animal_identities_visibility_idx";--> statement-breakpoint
ALTER TABLE "animal_identities" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "animals_status_listed_idx" ON "animals" USING btree ("status","listed_at","id");--> statement-breakpoint
CREATE INDEX "animal_identities_visibility_idx" ON "animal_identities" USING btree ("animal_id","disappeared_at","last_seen_at","source_updated_at");