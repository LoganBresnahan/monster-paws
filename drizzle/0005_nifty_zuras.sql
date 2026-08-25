DROP INDEX "animal_identities_animal_idx";--> statement-breakpoint
CREATE INDEX "animal_identities_visibility_idx" ON "animal_identities" USING btree ("animal_id","disappeared_at","last_seen_at");--> statement-breakpoint
CREATE INDEX "animals_status_created_idx" ON "animals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "animals_species_idx" ON "animals" USING btree ("species");--> statement-breakpoint
CREATE INDEX "animals_state_idx" ON "animals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "animals_shelter_external_idx" ON "animals" USING btree ("shelter_external_id");