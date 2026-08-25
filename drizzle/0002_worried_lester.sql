CREATE TABLE "animal_identities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"animal_id" integer NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "animals" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "animals" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "animal_identities" ADD CONSTRAINT "animal_identities_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animal_identities_source_ext_uq" ON "animal_identities" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "animal_identities_animal_idx" ON "animal_identities" USING btree ("animal_id");