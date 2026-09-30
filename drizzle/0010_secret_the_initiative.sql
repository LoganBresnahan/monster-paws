CREATE TABLE "ingest_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"complete" boolean NOT NULL,
	"lifecycle_skipped" text,
	"observed" integer NOT NULL,
	"persisted" integer NOT NULL,
	"deduped" integer NOT NULL,
	"normalized" integer NOT NULL,
	"conflicted" integer NOT NULL,
	"failures" integer NOT NULL,
	"events" jsonb NOT NULL,
	"clock_stepped_back_ms" integer
);
--> statement-breakpoint
CREATE INDEX "ingest_runs_source_finished_idx" ON "ingest_runs" USING btree ("source","finished_at");