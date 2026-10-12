-- Wake on row (designs/2026-10-11-push-not-poll.md): a row a loop must act on tells the box at
-- commit, `pg_notify('wren_wake', '<Service>/<unit>')`. The box's listener calls that loop's
-- `wake`, keyed to this database's owner. Postgres folds equal notices in one transaction, so a
-- bulk insert is one wake. With no listener a notice costs nothing and the loop's net still runs.
CREATE FUNCTION wren_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wren_wake', TG_ARGV[0]);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER sms_messages_wake AFTER INSERT OR UPDATE OF state ON sms_messages
  FOR EACH ROW WHEN (NEW.state = 'queued' AND NEW.direction = 'out')
  EXECUTE FUNCTION wren_wake('SmsSender/fleet');--> statement-breakpoint
CREATE TRIGGER reach_messages_wake AFTER INSERT OR UPDATE OF state ON reach_messages
  FOR EACH ROW WHEN (NEW.state = 'queued' AND NEW.direction = 'out')
  EXECUTE FUNCTION wren_wake('ReachSender/fleet');
