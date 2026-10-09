CREATE TABLE "auto_replies" (
	"channel" varchar(8) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"updated_by" varchar(200) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_auto_replies" PRIMARY KEY("channel"),
	CONSTRAINT "ck_auto_replies_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'text'::character varying, 'dm'::character varying, 'comment'::character varying])::text[])),
	CONSTRAINT "ck_auto_replies_mode" CHECK (("mode")::text = ANY ((ARRAY['off'::character varying, 'suggest'::character varying, 'auto'::character varying])::text[]))
);
