-- comments settings: authorTitle → authorJobTitle, LinkedIn's own filter name (autobrowse designs/2026-11-03-search-filters.md); clients.products held none (2026-11-03)
UPDATE "wren_settings" SET "settings" = ("settings" - 'authorTitle') || jsonb_build_object('authorJobTitle', "settings"->'authorTitle') WHERE "settings" ? 'authorTitle';
