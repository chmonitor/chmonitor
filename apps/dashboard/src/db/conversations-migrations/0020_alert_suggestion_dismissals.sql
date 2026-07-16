-- Smart alert-rule suggestions (issue #2667): persist which suggested rules an
-- owner has dismissed, so a dismissed suggestion stays dismissed across
-- recomputes. Mirrors the AI-insights stable-key dismissal pattern, but
-- server-side in D1 because suggestions are computed server-side (the insight
-- cards dismiss in localStorage instead). `suggestion_key` is the stable
-- `${metric}:host:${hostId}` key emitted by lib/health/alert-suggestions.ts —
-- never free-form SQL. `owner_id` follows the same single-tenant convention as
-- custom_alert_rules / alert_routes: 'oss' (self-hosted / no Clerk) or the
-- Clerk user id in cloud mode.
CREATE TABLE IF NOT EXISTS alert_suggestion_dismissals (
  owner_id       TEXT NOT NULL,
  suggestion_key TEXT NOT NULL,
  dismissed_at   INTEGER NOT NULL,
  PRIMARY KEY (owner_id, suggestion_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_suggestion_dismissals_owner
  ON alert_suggestion_dismissals (owner_id);
