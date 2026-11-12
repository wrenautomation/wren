-- 0315's refusal named `wren shape convert`, dropped in WA-1334; same check, the store's own words (CONVERT_FIRST).
CREATE OR REPLACE FUNCTION "pipeline"."metro_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body ->> 'model' IS DISTINCT FROM 'metro' THEN
    RAISE EXCEPTION 'Refused: a graph body. Every shape is on the metro model.';
  END IF;
  RETURN NEW;
END $$;
