-- D1 schema for the pixel host. One append-only table; the OpensScheduler
-- pulls forward by `id`, so nothing here is ever updated or deleted.
CREATE TABLE IF NOT EXISTS hits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL,
    seen_at    TEXT NOT NULL,  -- ISO 8601 UTC, set by the worker
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS hits_token ON hits (token);
