-- Delivery became installable components (designs/2026-10-04-components-and-marketplace.md, C3).
-- A client with a project already has them: install the four where they're missing, so nothing
-- it sees or gets mailed goes away. Settings left on a key stay as they are.
UPDATE "clients"
SET "products" = '{"delivery.portal": {}, "delivery.invoices": {}, "delivery.reviews": {}, "delivery.contract": {}}'::jsonb || "products"
WHERE EXISTS (SELECT 1 FROM "delivery"."engagements" e WHERE e."client_id" = "clients"."id");
