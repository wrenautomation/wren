# auth: schema

Tables and views: 7.

## auth.account (table)

- `id text`
- `user_id text`
- `provider_id text`
- `account_id text`
- `access_token text null`
- `refresh_token text null`
- `id_token text null`
- `access_token_expires_at timestamp with time zone null`
- `refresh_token_expires_at timestamp with time zone null`
- `scope text null`
- `password text null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE UNIQUE INDEX account_pkey ON auth.account USING btree (id)`
- `CREATE INDEX ix_auth_account_user ON auth.account USING btree (user_id)`

## auth.jwks (table)

- `id text`
- `public_key text`
- `private_key text`
- `alg text null`
- `crv text null`
- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone null`

Indexes:

- `CREATE UNIQUE INDEX jwks_pkey ON auth.jwks USING btree (id)`

## auth.rate_limit (table)

- `id text`
- `key text`
- `count integer`
- `last_request bigint`

Indexes:

- `CREATE UNIQUE INDEX rate_limit_pkey ON auth.rate_limit USING btree (id)`
- `CREATE UNIQUE INDEX rate_limit_key_unique ON auth.rate_limit USING btree (key)`

## auth.session (table)

- `id text`
- `token text`
- `user_id text`
- `expires_at timestamp with time zone`
- `ip_address text null`
- `user_agent text null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE UNIQUE INDEX session_pkey ON auth.session USING btree (id)`
- `CREATE UNIQUE INDEX session_token_unique ON auth.session USING btree (token)`
- `CREATE INDEX ix_auth_session_user ON auth.session USING btree (user_id)`

## auth.user (table)

- `id text`
- `name text`
- `email text`
- `email_verified boolean = false`
- `image text null`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX user_pkey ON auth."user" USING btree (id)`
- `CREATE UNIQUE INDEX user_email_unique ON auth."user" USING btree (email)`

## auth.verification (table)

- `id text`
- `identifier text`
- `value text`
- `expires_at timestamp with time zone`
- `created_at timestamp with time zone = now()`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX verification_pkey ON auth.verification USING btree (id)`
- `CREATE INDEX ix_auth_verification_identifier ON auth.verification USING btree (identifier)`

## auth.passkey (table)

- `id text`
- `name text null`
- `public_key text`
- `user_id text`
- `credential_id text`
- `counter integer`
- `device_type text`
- `backed_up boolean`
- `transports text null`
- `created_at timestamp with time zone null = now()`
- `aaguid text null`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE UNIQUE INDEX passkey_pkey ON auth.passkey USING btree (id)`
- `CREATE UNIQUE INDEX passkey_credential_id_unique ON auth.passkey USING btree (credential_id)`
- `CREATE INDEX ix_auth_passkey_user ON auth.passkey USING btree (user_id)`
