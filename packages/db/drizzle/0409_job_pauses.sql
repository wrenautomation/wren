CREATE TABLE "job_pauses" (
	"id" serial NOT NULL,
	"job" varchar(200) NOT NULL,
	"why" text NOT NULL,
	"held_by" varchar(320) NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" varchar(320),
	CONSTRAINT "pk_job_pauses" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "unit_holds" ADD COLUMN "held_by" varchar(320);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_pauses_open_job" ON "job_pauses" USING btree ("job") WHERE released_at is null;