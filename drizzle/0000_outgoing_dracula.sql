CREATE TABLE "animals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"breed" text,
	"status" text DEFAULT 'available' NOT NULL,
	"shelter_external_id" text,
	"photo_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"embedding_model" text NOT NULL,
	"chunk" text NOT NULL,
	"dimensions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "animals_status_idx" ON "animals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "event_log_subject_idx" ON "event_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "raw_payloads_source_ext_idx" ON "raw_payloads" USING btree ("source","external_id");