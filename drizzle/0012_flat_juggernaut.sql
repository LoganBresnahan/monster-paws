CREATE TABLE "outreach_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shelter_external_id" text NOT NULL,
	"wave" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"message_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_events_one_send_per_wave_uq" ON "outreach_events" USING btree ("shelter_external_id","wave") WHERE kind = 'sent';--> statement-breakpoint
CREATE INDEX "outreach_events_shelter_idx" ON "outreach_events" USING btree ("shelter_external_id","occurred_at");--> statement-breakpoint
CREATE INDEX "outreach_events_wave_idx" ON "outreach_events" USING btree ("wave","kind");