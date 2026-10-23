-- Thread alert repeats under the first message of an episode (#4049).
--
-- One row per alert episode per channel destination: `thread_key` hashes
-- host, rule, channel and destination (never a raw token), `root_id` is the
-- first message's id on that channel (a Matrix event id, a Telegram
-- message_id). Reminders, escalations and the recovery reply under it; the
-- recovery deletes the row, and the next episode's first alert replaces it.

CREATE TABLE IF NOT EXISTS alert_thread_roots (
  owner_id   TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  root_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, thread_key)
);
