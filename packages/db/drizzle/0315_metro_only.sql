-- HELD (C1 part 4): every new shape version and shape draft is a metro body. A graph body is
-- refused at the door. Rows stored before this stay as they are: the triggers fire on new rows only.
-- A draft is also checked when its body is written again (`updateDraft`); a state change is not.
CREATE FUNCTION "pipeline"."metro_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body ->> 'model' IS DISTINCT FROM 'metro' THEN
    RAISE EXCEPTION 'Convert first: wren shape convert.';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "shape_versions_metro_only" BEFORE INSERT ON "pipeline"."shape_versions" FOR EACH ROW EXECUTE FUNCTION "pipeline"."metro_only"();--> statement-breakpoint
CREATE TRIGGER "shape_drafts_metro_only" BEFORE INSERT OR UPDATE OF "body" ON "pipeline"."shape_drafts" FOR EACH ROW EXECUTE FUNCTION "pipeline"."metro_only"();
