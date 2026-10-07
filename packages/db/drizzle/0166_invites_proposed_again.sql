-- Invites queued before the To approve gate (0161) never had his yes. Send them back to wait for it.
UPDATE "reach_messages" SET "state" = 'proposed', "state_reason" = 'queued before the approve step'
WHERE "kind" = 'connect' AND "direction" = 'out' AND "state" = 'queued';
