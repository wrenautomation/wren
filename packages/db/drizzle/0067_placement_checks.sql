CREATE TABLE "placement_checks" (
	"sender" varchar(320) NOT NULL,
	"seed" varchar(320) NOT NULL,
	"day" date NOT NULL,
	"message_id" varchar(255),
	"sent_at" timestamp with time zone,
	"landed" varchar(16),
	"checked_at" timestamp with time zone,
	"detail" text,
	CONSTRAINT "pk_placement_checks" PRIMARY KEY("sender","seed","day"),
	CONSTRAINT "ck_placement_checks_placement" CHECK (("landed")::text = ANY ((ARRAY['inbox'::character varying, 'promotions'::character varying, 'spam'::character varying, 'missing'::character varying])::text[]))
);
