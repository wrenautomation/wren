-- One truth for accounts: every account saved on a client (clients.accounts) gets its registry
-- row, so Accounts lists it. Saving one writes both from here on (core clients registerAccounts).
INSERT INTO "client_accounts" ("client", "site", "ref", "created_by")
SELECT c."id", kv.key, left(btrim(kv.value), 200), 'clients'
FROM "clients" c, jsonb_each_text(c."accounts") kv
WHERE btrim(kv.value) <> ''
  AND kv.key IN ('gmail', 'linkedin', 'calcom', 'telnyx', 'meta', 'search_console',
    'google_calendar', 'youtube', 'linkedin_page', 'x', 'tiktok', 'instagram', 'reddit', 'postmaster')
ON CONFLICT DO NOTHING;
