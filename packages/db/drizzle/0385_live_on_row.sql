-- Live topics on row (designs/2026-11-08-live-topics.md): a commit on a table an open page shows
-- tells the box `pg_notify('wren_live', '<topic>')`; the box relays it to the portal's LiveRoom
-- (`tellLive`), and each tab on that topic reads again. Every writer counts: Lambda, box, the CLI on
-- the Mac, SQL by hand. Statement-level where the whole table is one topic: a bulk write is one notice.
CREATE FUNCTION wren_live() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wren_live', TG_ARGV[0]);
  RETURN NULL;
END $$;--> statement-breakpoint
-- `runs` holds many commands: only the ones a page shows as turns or steps.
CREATE FUNCTION wren_live_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.command IN ('ask', 'record-ask', 'draft-ask') THEN
    PERFORM pg_notify('wren_live', 'ask');
  ELSIF NEW.command IN ('video-ask', 'video-edit') OR NEW.command LIKE 'video %' THEN
    PERFORM pg_notify('wren_live', 'videos');
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER runs_live AFTER INSERT OR UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION wren_live_run();--> statement-breakpoint
CREATE TRIGGER decisions_live AFTER INSERT OR UPDATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION wren_live('decisions');--> statement-breakpoint
CREATE TRIGGER profile_lookups_live AFTER INSERT OR UPDATE ON profile_lookups
  FOR EACH STATEMENT EXECUTE FUNCTION wren_live('research');--> statement-breakpoint
CREATE TRIGGER video_edits_live AFTER INSERT OR UPDATE OR DELETE ON video_edits
  FOR EACH STATEMENT EXECUTE FUNCTION wren_live('videos');--> statement-breakpoint
CREATE TRIGGER video_marks_live AFTER INSERT OR UPDATE OR DELETE ON video_marks
  FOR EACH STATEMENT EXECUTE FUNCTION wren_live('videos');--> statement-breakpoint
CREATE TRIGGER video_presence_live AFTER INSERT OR UPDATE OR DELETE ON video_presence
  FOR EACH STATEMENT EXECUTE FUNCTION wren_live('videos');
