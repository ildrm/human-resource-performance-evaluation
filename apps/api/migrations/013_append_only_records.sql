CREATE FUNCTION reject_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER calibration_decisions_append_only
  BEFORE UPDATE OR DELETE ON calibration_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER goal_revisions_append_only
  BEFORE UPDATE OR DELETE ON goal_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER goal_checkins_append_only
  BEFORE UPDATE OR DELETE ON goal_checkins
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER development_action_events_append_only
  BEFORE UPDATE OR DELETE ON development_action_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
