-- Back-off of repeat alert reminders while a value stays flat (#4049).
--
-- `repeat_count` is how many reminders were sent since the state last changed
-- or the value last moved, so the next interval can be `cooldown * 2^count`
-- (`HEALTH_ALERT_BACKOFF_MAX_MINUTES`). NULL = 0.

ALTER TABLE alert_state ADD COLUMN repeat_count INTEGER;
