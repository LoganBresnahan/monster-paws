CREATE TABLE "painting_email_sends" (
	"keepsake_id" integer PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_id" text,
	"refused_code" text
);
--> statement-breakpoint
CREATE TABLE "resend_webhook_events" (
	"svix_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"email_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "painting_email_sends" ADD CONSTRAINT "painting_email_sends_keepsake_id_keepsake_id_fk" FOREIGN KEY ("keepsake_id") REFERENCES "public"."keepsake"("id") ON DELETE no action ON UPDATE no action;