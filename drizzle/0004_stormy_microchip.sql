CREATE TABLE "animal_display" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"animal_id" integer NOT NULL,
	"source" text NOT NULL,
	"description" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listing_org" text,
	"tracker_url" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "org_name" text;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "animal_display" ADD CONSTRAINT "animal_display_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animal_display_animal_source_uq" ON "animal_display" USING btree ("animal_id","source");