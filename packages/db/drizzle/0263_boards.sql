CREATE TABLE "board_shares" (
	"board_id" uuid NOT NULL,
	"who" varchar(200) NOT NULL,
	"role" varchar(8) NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_board_shares" PRIMARY KEY("board_id","who"),
	CONSTRAINT "ck_board_shares_role" CHECK (("role")::text = ANY ((ARRAY['view'::character varying, 'comment'::character varying, 'edit'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"columns" jsonb NOT NULL,
	"owner" varchar(200) NOT NULL,
	"general" varchar(12) DEFAULT 'private' NOT NULL,
	"general_role" varchar(8) DEFAULT 'view' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_boards" PRIMARY KEY("id"),
	CONSTRAINT "ck_boards_general" CHECK (("general")::text = ANY ((ARRAY['private'::character varying, 'workspace'::character varying])::text[])),
	CONSTRAINT "ck_boards_general_role" CHECK (("general_role")::text = ANY ((ARRAY['view'::character varying, 'comment'::character varying, 'edit'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "task_blocks" (
	"task_id" uuid NOT NULL,
	"blocked_by" uuid NOT NULL,
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_task_blocks" PRIMARY KEY("task_id","blocked_by"),
	CONSTRAINT "ck_task_blocks_self" CHECK ("task_blocks"."task_id" <> "task_blocks"."blocked_by")
);
--> statement-breakpoint
CREATE TABLE "task_moves" (
	"id" bigserial NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"from_column" varchar(40),
	"to_column" varchar(40),
	"assignee" varchar(200),
	"by" varchar(200) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"why" varchar(300),
	CONSTRAINT "pk_task_moves" PRIMARY KEY("id"),
	CONSTRAINT "ck_task_moves_kind" CHECK (("kind")::text = ANY ((ARRAY['create'::character varying, 'move'::character varying, 'assign'::character varying, 'close'::character varying, 'reopen'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "ck_notes_kind";--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "column_id" varchar(40);--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "position" varchar(64);--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "assignee" varchar(200);--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "due" date;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_shares" ADD CONSTRAINT "fk_board_shares_board" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blocks" ADD CONSTRAINT "fk_task_blocks_task" FOREIGN KEY ("task_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blocks" ADD CONSTRAINT "fk_task_blocks_blocked_by" FOREIGN KEY ("blocked_by") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_moves" ADD CONSTRAINT "fk_task_moves_task" FOREIGN KEY ("task_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_board_shares_who" ON "board_shares" USING btree ("who");--> statement-breakpoint
CREATE INDEX "ix_boards_owner" ON "boards" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_boards_default" ON "boards" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE INDEX "ix_task_blocks_blocked_by" ON "task_blocks" USING btree ("blocked_by");--> statement-breakpoint
CREATE INDEX "ix_task_moves_task_at" ON "task_moves" USING btree ("task_id","at");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_board" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_notes_board" ON "notes" USING btree ("board_id","column_id");--> statement-breakpoint
CREATE INDEX "ix_notes_assignee" ON "notes" USING btree ("assignee") WHERE "notes"."assignee" is not null;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "ck_notes_board_task" CHECK ("notes"."board_id" is null or "notes"."kind"::text = 'task');--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "ck_notes_kind" CHECK (("kind")::text = ANY ((ARRAY['note'::character varying, 'dump'::character varying, 'task'::character varying])::text[]));