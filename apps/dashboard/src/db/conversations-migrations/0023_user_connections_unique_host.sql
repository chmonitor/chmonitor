-- Uniqueness guard for per-user connection host ids (issue #2676).
--
-- `host_id` is the value the whole dashboard uses for `?host=N` routing, so
-- two of a user's connections must never share one. The store used to compute
-- the next id in JS from a plain SELECT taken before the INSERT, so two
-- concurrent creates could both read the same snapshot and insert the SAME
-- host_id. The store now allocates the id inside the INSERT statement itself
-- (atomic per D1's single-statement guarantee); this unique index is the
-- database-level backstop so no code path can ever reintroduce a duplicate.
--
-- Step 1: repair any duplicates an earlier race may have left behind, keeping
-- the oldest row of each (user_id, host_id) pair on its id and moving each
-- newer duplicate to a fresh id below the user's current minimum (only
-- DB-range ids, <= -1000, are touched — the table never stores env-host ids).
UPDATE user_connections
SET host_id = (
  SELECT m.min_id - d.k
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY created_at, id
      ) AS k
    FROM (
      SELECT
        id,
        user_id,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, host_id
          ORDER BY created_at, id
        ) AS rn
      FROM user_connections
      WHERE host_id <= -1000
    )
    WHERE rn > 1
  ) AS d
  JOIN (
    SELECT user_id, MIN(host_id) AS min_id
    FROM user_connections
    WHERE host_id <= -1000
    GROUP BY user_id
  ) AS m
    ON m.user_id = user_connections.user_id
  WHERE d.id = user_connections.id
)
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, host_id
        ORDER BY created_at, id
      ) AS rn
    FROM user_connections
    WHERE host_id <= -1000
  )
  WHERE rn > 1
);

-- Step 2: enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_connections_user_host
  ON user_connections(user_id, host_id);
