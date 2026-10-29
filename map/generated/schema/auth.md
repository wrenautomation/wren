# auth: schema

Tables and views: 7.

## auth.account (table)

- `access_token text null`
- `access_token_expires_at timestamp with time zone null`
- `account_id text`
- `created_at timestamp with time zone = now()`
- `id text`
- `id_token text null`
- `password text null`
- `provider_id text`
- `refresh_token text null`
- `refresh_token_expires_at timestamp with time zone null`
- `scope text null`
- `updated_at timestamp with time zone = now()`
- `user_id text`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE UNIQUE INDEX account_pkey ON auth.account USING btree (id)`
- `CREATE INDEX ix_auth_account_user ON auth.account USING btree (user_id)`

## auth.jwks (table)

- `alg text null`
- `created_at timestamp with time zone = now()`
- `crv text null`
- `expires_at timestamp with time zone null`
- `id text`
- `private_key text`
- `public_key text`

Indexes:

- `CREATE UNIQUE INDEX jwks_pkey ON auth.jwks USING btree (id)`

## auth.passkey (table)

- `aaguid text null`
- `backed_up boolean`
- `counter integer`
- `created_at timestamp with time zone null = now()`
- `credential_id text`
- `device_type text`
- `id text`
- `name text null`
- `public_key text`
- `transports text null`
- `user_id text`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE INDEX ix_auth_passkey_user ON auth.passkey USING btree (user_id)`
- `CREATE UNIQUE INDEX passkey_credential_id_unique ON auth.passkey USING btree (credential_id)`
- `CREATE UNIQUE INDEX passkey_pkey ON auth.passkey USING btree (id)`

## auth.rate_limit (table)

- `count integer`
- `id text`
- `key text`
- `last_request bigint`

Indexes:

- `CREATE UNIQUE INDEX rate_limit_key_unique ON auth.rate_limit USING btree (key)`
- `CREATE UNIQUE INDEX rate_limit_pkey ON auth.rate_limit USING btree (id)`

## auth.session (table)

- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `id text`
- `ip_address text null`
- `token text`
- `updated_at timestamp with time zone = now()`
- `user_agent text null`
- `user_id text`

References:

- auth.user (user_id → id)

Indexes:

- `CREATE INDEX ix_auth_session_user ON auth.session USING btree (user_id)`
- `CREATE UNIQUE INDEX session_pkey ON auth.session USING btree (id)`
- `CREATE UNIQUE INDEX session_token_unique ON auth.session USING btree (token)`

## auth.user (table)

- `created_at timestamp with time zone = now()`
- `email text`
- `email_verified boolean = false`
- `id text`
- `image text null`
- `name text`
- `updated_at timestamp with time zone = now()`

Indexes:

- `CREATE UNIQUE INDEX user_email_unique ON auth."user" USING btree (email)`
- `CREATE UNIQUE INDEX user_pkey ON auth."user" USING btree (id)`

## auth.verification (table)

- `created_at timestamp with time zone = now()`
- `expires_at timestamp with time zone`
- `id text`
- `identifier text`
- `updated_at timestamp with time zone = now()`
- `value text`

Indexes:

- `CREATE INDEX ix_auth_verification_identifier ON auth.verification USING btree (identifier)`
- `CREATE UNIQUE INDEX verification_pkey ON auth.verification USING btree (id)`
