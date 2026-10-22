CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"animal_source" text NOT NULL,
	"animal_external_id" text NOT NULL,
	"nonprofit_slug" text NOT NULL,
	"nonprofit_ein" text NOT NULL,
	"account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "donation_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"animal_source" text NOT NULL,
	"animal_external_id" text NOT NULL,
	"nonprofit_slug" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"frequency" text NOT NULL,
	"donated_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"webhook_payload_id" integer NOT NULL,
	"charge_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"net_amount" numeric(12, 2),
	"currency" text NOT NULL,
	"frequency" text NOT NULL,
	"nonprofit_slug" text NOT NULL,
	"nonprofit_ein" text NOT NULL,
	"nonprofit_name" text NOT NULL,
	"donated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email_hmac" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "everyorg_webhook_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"headers" jsonb NOT NULL,
	"partner_donation_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keepsake" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"donation_id" integer NOT NULL,
	"snapshotted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "keepsake_donation_uq" UNIQUE("donation_id")
);
--> statement-breakpoint
CREATE TABLE "keepsake_fact" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"keepsake_id" integer NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"basis" text NOT NULL,
	"snapshotted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shelter_nonprofits" (
	"shelter_external_id" text PRIMARY KEY NOT NULL,
	"everyorg_slug" text NOT NULL,
	"ein" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"account_id" integer,
	"intent_id" text,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "donation_intents" ADD CONSTRAINT "donation_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_intent_id_donation_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."donation_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_webhook_payload_id_everyorg_webhook_payloads_id_fk" FOREIGN KEY ("webhook_payload_id") REFERENCES "public"."everyorg_webhook_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keepsake" ADD CONSTRAINT "keepsake_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keepsake_fact" ADD CONSTRAINT "keepsake_fact_keepsake_id_keepsake_id_fk" FOREIGN KEY ("keepsake_id") REFERENCES "public"."keepsake"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_links" ADD CONSTRAINT "sign_in_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_links" ADD CONSTRAINT "sign_in_links_intent_id_donation_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."donation_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_lower_uq" ON "accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "donation_intents_account_idx" ON "donation_intents" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "donation_stats_animal_idx" ON "donation_stats" USING btree ("animal_source","animal_external_id");--> statement-breakpoint
CREATE INDEX "donation_stats_nonprofit_idx" ON "donation_stats" USING btree ("nonprofit_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "donations_charge_uq" ON "donations" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "donations_intent_idx" ON "donations" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "everyorg_webhook_payloads_partner_idx" ON "everyorg_webhook_payloads" USING btree ("partner_donation_id");--> statement-breakpoint
CREATE INDEX "keepsake_fact_keepsake_idx" ON "keepsake_fact" USING btree ("keepsake_id","field");--> statement-breakpoint
CREATE INDEX "keepsake_fact_basis_idx" ON "keepsake_fact" USING btree ("basis");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_credential_uq" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_credentials_account_idx" ON "passkey_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_links_token_hash_uq" ON "sign_in_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sign_in_links_account_idx" ON "sign_in_links" USING btree ("account_id");