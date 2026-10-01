import { defineConfig } from "drizzle-kit";

// Every package owns its schema file; this list is the only place they meet.
// Paths, not imports: @wren/db must stay a leaf dependency.
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "../core/src/schema.ts",
    "../core/src/views.ts",
    "../core/src/clients/schema.ts",
    "../research/src/schema.ts",
    "../channel-email/src/schema.ts",
    "../channel-email/src/views.ts",
    "../content/src/schema.ts",
    "../channel-meta/src/schema.ts",
    "../channel-sms/src/schema.ts",
    "../reactivation/src/schema.ts",
    "../books/src/schema.ts",
    "../channel-search/src/schema.ts",
    "../auth/src/schema.ts",
  ],
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.WREN_DATABASE_URL ?? "postgresql://wren:wren@127.0.0.1:5434/wren",
  },
  strict: true,
  verbose: true,
});
