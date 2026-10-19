-- A journey opening or moving wakes the workspace's segments pass at commit, so a live group
-- with a journey condition follows it (designs/2026-10-18-journeys.md, wa-8pi.8). One notice per
-- statement; the pass folds bursts. A version carry changes `version` only and wakes nothing.
CREATE TRIGGER journeys_segments_wake AFTER INSERT OR UPDATE OF stage, status ON pipeline.journeys
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');
