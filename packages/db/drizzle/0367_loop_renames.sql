-- Loop renames (designs/2026-11-04-loops.md): wake triggers name the new services.
DROP TRIGGER sms_messages_wake ON sms_messages;--> statement-breakpoint
CREATE TRIGGER sms_messages_wake AFTER INSERT OR UPDATE OF state ON sms_messages
  FOR EACH ROW WHEN (NEW.state = 'queued' AND NEW.direction = 'out')
  EXECUTE FUNCTION wren_wake('SmsSend/fleet');--> statement-breakpoint
DROP TRIGGER reach_messages_wake ON reach_messages;--> statement-breakpoint
CREATE TRIGGER reach_messages_wake AFTER INSERT OR UPDATE OF state ON reach_messages
  FOR EACH ROW WHEN (NEW.state = 'queued' AND NEW.direction = 'out')
  EXECUTE FUNCTION wren_wake('ReachSend/fleet');--> statement-breakpoint
DROP TRIGGER touches_feed_wake ON touches;--> statement-breakpoint
CREATE TRIGGER touches_feed_wake AFTER INSERT ON touches
  FOR EACH ROW EXECUTE FUNCTION wren_wake('TouchToJourney/all');