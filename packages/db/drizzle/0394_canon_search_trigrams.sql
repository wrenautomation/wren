-- Canon search (`ilike` on title, id, body): the knowledge engine (0.75.1+) builds its trigram index on
-- canon.knowledge_records once this extension exists; without it, each search is a seq scan (~160 ms on 10k records).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
