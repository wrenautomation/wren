CREATE TABLE "agent_workspaces" (
	"name" varchar(40) NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_agent_workspaces" PRIMARY KEY("name")
);
