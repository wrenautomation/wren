CREATE TABLE "chat_messages" (
	"id" serial NOT NULL,
	"thread_id" integer NOT NULL,
	"direction" varchar(3) NOT NULL,
	"body" text NOT NULL,
	"by" varchar(200),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_chat_messages" PRIMARY KEY("id"),
	CONSTRAINT "ck_chat_messages_direction" CHECK (("direction")::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" serial NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"name" varchar(120),
	"email" varchar(200),
	"phone" varchar(32),
	"page" text,
	"last_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_chat_threads" PRIMARY KEY("id"),
	CONSTRAINT "uq_chat_threads_key" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "auto_replies" DROP CONSTRAINT "ck_auto_replies_channel";--> statement-breakpoint
ALTER TABLE "inbox_replies" DROP CONSTRAINT "ck_inbox_replies_channel";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "fk_chat_messages_thread" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_chat_messages_thread" ON "chat_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX "ix_chat_threads_last" ON "chat_threads" USING btree ("last_in_at");--> statement-breakpoint
CREATE INDEX "ix_chat_threads_created" ON "chat_threads" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "auto_replies" ADD CONSTRAINT "ck_auto_replies_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'text'::character varying, 'dm'::character varying, 'comment'::character varying, 'chat'::character varying])::text[]));--> statement-breakpoint
ALTER TABLE "inbox_replies" ADD CONSTRAINT "ck_inbox_replies_channel" CHECK (("channel")::text = ANY ((ARRAY['email'::character varying, 'text'::character varying, 'dm'::character varying, 'comment'::character varying, 'chat'::character varying])::text[]));