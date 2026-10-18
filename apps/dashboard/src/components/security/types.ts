export type AuditEntry = {
  id: string
  timestamp: string
  operation: string
  ddl: string
  success: boolean
  error?: string
  hostId: number
}

export type ManagementOperation =
  | 'create_user'
  | 'alter_user'
  | 'drop_user'
  | 'grant_role'
  | 'revoke_role'
  | 'grant_privilege'
  | 'revoke_privilege'

export type ApiResponse =
  | { success: true; ddl: string; message: string }
  | { success: false; error: string }
