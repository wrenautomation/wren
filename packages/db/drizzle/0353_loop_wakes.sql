-- Wakes only on a changed row (designs/2026-11-01-loop-calls.md). A statement trigger fires on a
-- statement that changes nothing: the people map's trait sync woke every workspace's segments
-- pass each 15 minutes. Row triggers fire per changed row; Postgres folds equal notices in one
-- transaction, so a bulk write is still one wake.
DROP TRIGGER profile_traits_segments_wake ON profile_traits;--> statement-breakpoint
DROP TRIGGER profile_keys_segments_wake ON profile_keys;--> statement-breakpoint
DROP TRIGGER profile_events_segments_wake ON profile_events;--> statement-breakpoint
DROP TRIGGER segments_segments_wake ON segments;--> statement-breakpoint
DROP TRIGGER instances_segments_wake ON pipeline.instances;--> statement-breakpoint
CREATE TRIGGER profile_traits_segments_wake AFTER INSERT OR DELETE ON profile_traits
  FOR EACH ROW EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_traits_segments_wake_update AFTER UPDATE ON profile_traits
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_keys_segments_wake AFTER INSERT OR DELETE ON profile_keys
  FOR EACH ROW EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_keys_segments_wake_update AFTER UPDATE ON profile_keys
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_events_segments_wake AFTER INSERT ON profile_events
  FOR EACH ROW EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER segments_segments_wake AFTER INSERT ON segments
  FOR EACH ROW EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER segments_segments_wake_update AFTER UPDATE OF rule, state ON segments
  FOR EACH ROW WHEN (OLD.rule IS DISTINCT FROM NEW.rule OR OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
-- A version carry sets `version` only and wakes nothing.
CREATE TRIGGER instances_segments_wake AFTER INSERT ON pipeline.instances
  FOR EACH ROW EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER instances_segments_wake_update AFTER UPDATE OF node, status ON pipeline.instances
  FOR EACH ROW WHEN (OLD.node IS DISTINCT FROM NEW.node OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
-- A new touch wakes the one touch feed over every workspace: `all` is not keyed to the owner.
CREATE TRIGGER touches_feed_wake AFTER INSERT ON touches
  FOR EACH ROW EXECUTE FUNCTION wren_wake('TouchFeed/all');
