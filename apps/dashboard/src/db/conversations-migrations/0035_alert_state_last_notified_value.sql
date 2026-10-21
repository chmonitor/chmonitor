-- Value-delta suppression of repeat alert reminders (#4049).
--
-- `last_notified_value` is the observed value at the last notification
-- actually dispatched, so a reminder can be skipped when the value has barely
-- moved (`HEALTH_ALERT_REPEAT_MIN_DELTA`). NULL = unknown; reminders then send.

ALTER TABLE alert_state ADD COLUMN last_notified_value REAL;
