import { QUERY_COMMENT } from '@chm/clickhouse-client/constants' // pragma: allowlist secret
import { CLUSTER_FANOUT_SETTINGS } from '@/lib/cluster/fanout-settings'

function wrapSettingsView(
  table: 'system.settings' | 'system.merge_tree_settings'
): string {
  return `
    ${QUERY_COMMENT}
    SELECT * FROM clusterAllReplicas(
      {cluster:String},
      view(
        SELECT
          hostName() AS node_host,
          name,
          value,
          changed,
          description,
          default AS defaultValue
        FROM ${table}
      )
    )
    ${CLUSTER_FANOUT_SETTINGS}
  `
}

export const CLUSTER_SETTINGS_QUERY = wrapSettingsView('system.settings')

export const CLUSTER_MERGE_TREE_SETTINGS_QUERY = wrapSettingsView(
  'system.merge_tree_settings'
)
