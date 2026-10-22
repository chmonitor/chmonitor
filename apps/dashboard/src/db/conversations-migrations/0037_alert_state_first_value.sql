-- Value at the start of an incident, for the opt-in long-firing digest (#4049).
--
-- `first_value` is the observed value when the condition began firing, shown
-- next to the current value in the daily digest
-- (`HEALTH_ALERT_LONG_FIRING_DIGEST_HOURS`). NULL = unknown.

ALTER TABLE alert_state ADD COLUMN first_value REAL;
