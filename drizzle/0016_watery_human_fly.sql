CREATE TABLE "everyorg_webhook_decisions" (
	"payload_id" bigint PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "everyorg_webhook_decisions" ADD CONSTRAINT "everyorg_webhook_decisions_payload_id_everyorg_webhook_payloads_id_fk" FOREIGN KEY ("payload_id") REFERENCES "public"."everyorg_webhook_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every row already here was decided by the code that received it, so the replay must never re-run one:
-- the outcome wasn't recorded then, and this names that instead of guessing (ADR-0027 as amended 2026-11-03).
INSERT INTO "everyorg_webhook_decisions" ("payload_id", "outcome", "decided_at")
SELECT "id", 'before_this_table', "received_at" FROM "everyorg_webhook_payloads";
