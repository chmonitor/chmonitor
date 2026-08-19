/** Shared SETTINGS clause for clusterAllReplicas fan-out (partial outage ok). */
export const CLUSTER_FANOUT_SETTINGS = `SETTINGS
      skip_unavailable_shards = 1,
      connections_with_failover_max_tries = 1,
      connect_timeout_with_failover_ms = 2000`
