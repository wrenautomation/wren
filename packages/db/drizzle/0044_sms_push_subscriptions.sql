CREATE TABLE "sms_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"operator" varchar(200) NOT NULL,
	"last_pushed_at" timestamp with time zone,
	CONSTRAINT "uq_sms_push_subscriptions_endpoint" UNIQUE("endpoint")
);
