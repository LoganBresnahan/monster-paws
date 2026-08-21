ALTER TABLE "animals" ADD COLUMN "sex" text;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "age_group" text;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "birth_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "is_birth_date_exact" boolean;