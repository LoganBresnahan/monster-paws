CREATE TABLE "shelter_contacts" (
	"shelter_external_id" text NOT NULL,
	"email" text NOT NULL,
	"source_url" text NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"note" text,
	CONSTRAINT "shelter_contacts_shelter_external_id_email_pk" PRIMARY KEY("shelter_external_id","email")
);
