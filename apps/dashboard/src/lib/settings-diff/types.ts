export type SettingsDiffTable = 'settings' | 'merge_tree_settings'

export type SettingsDiffHostInfo = { id: number; name: string }

export type SettingsDiffRowValue = {
  value: string
  changed: number
  defaultValue: string
}

export type SettingsDiffRow = {
  name: string
  table: SettingsDiffTable
  values: Record<number, SettingsDiffRowValue>
  hasDiff: boolean
  changedFromDefault: boolean
}

export type SettingsDiffView = 'matrix' | 'pair'

export type SettingsDiffResponse = {
  success: boolean
  hosts: SettingsDiffHostInfo[]
  nodes: SettingsDiffHostInfo[]
  scope: 'hosts' | 'nodes'
  view?: SettingsDiffView
  sourceHostId: number | null
  targetHostId: number | null
  rows: SettingsDiffRow[]
  error?: string
  unavailable?: { reason: string; message: string }
}
