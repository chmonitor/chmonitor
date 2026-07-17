-- Instance-scoped webhook subscriptions (#2664): `alert.fired`/`alert.resolved`
-- have no per-user owner — the health-alert cron sweep (server-sweep.ts) runs
-- over env-configured hosts (getClickHouseConfigs()), which belong to the
-- operator, not any signed-in Clerk user. `emitEvent`'s user-scoped lookup
-- (WHERE user_id = ?) has no owner to filter by for those events.
--
-- `scope` lets a subscription opt in to receiving instance-wide events
-- REGARDLESS of which user created it: 'user' (default, existing behavior)
-- keeps a subscription strictly tied to its creator's own events
-- (connection.created/deleted); 'instance' additionally allows
-- alert.fired/alert.resolved, delivered by scanning ALL users' instance-scoped
-- subscriptions (see subscription-store.ts's listInstanceScopedSubscriptionsForEvent).
ALTER TABLE webhook_subscriptions ADD COLUMN scope TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_scope_enabled
  ON webhook_subscriptions(scope, enabled);
