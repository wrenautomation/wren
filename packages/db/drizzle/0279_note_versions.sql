ALTER TABLE "boards" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- A board's and a card's row version (designs/2026-10-15-one-write-path.md, "Row versions"): one
-- up on every write, whichever code path makes it. Change-only reads and conflict checks compare
-- it in place of the text.
CREATE FUNCTION notes_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER boards_bump_version BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION notes_bump_version();--> statement-breakpoint
CREATE TRIGGER notes_bump_version BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_bump_version();
