-- Learn retired (WA-1317); William's yes 11-11 (WA-1318). Backup: jsonl per table, off repo.
-- One CASCADE: drizzle's per-view drops ran in the wrong order; takes the items_document trigger function too.
DROP SCHEMA "learn" CASCADE;
