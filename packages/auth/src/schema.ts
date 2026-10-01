import { bigint, boolean, index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better Auth's tables, in their own schema so `auth.account` never meets
 * `books.accounts`. The export names are the adapter's model names; the
 * columns are Better Auth's fields. Who sees which client is not here (A7):
 * that is `client_members` in the registry.
 */
export const auth = pgSchema("auth");

const at = (name: string) => timestamp(name, { withTimezone: true });

export const user = auth.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: at("created_at").defaultNow().notNull(),
  updatedAt: at("updated_at").defaultNow().notNull(),
});

export const session = auth.table(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: at("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ix_auth_session_user").on(t.userId)],
);

/** One row per sign-in method: `credential` (password), `google`, `microsoft`. */
export const account = auth.table(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: at("access_token_expires_at"),
    refreshTokenExpiresAt: at("refresh_token_expires_at"),
    scope: text("scope"),
    /** The password hash, for `credential`. */
    password: text("password"),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ix_auth_account_user").on(t.userId)],
);

/** Sign-in codes (hashed) and password-reset tokens. */
export const verification = auth.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: at("created_at").defaultNow().notNull(),
    updatedAt: at("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ix_auth_verification_identifier").on(t.identifier)],
);

/** The token signing keys; private halves encrypted with the auth secret. */
export const jwks = auth.table("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  alg: text("alg"),
  crv: text("crv"),
  createdAt: at("created_at").defaultNow().notNull(),
  expiresAt: at("expires_at"),
});

export const rateLimit = auth.table("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  /** Epoch milliseconds. */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
