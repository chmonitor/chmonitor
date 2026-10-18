import type { AuditEntry } from './types'

import { ConfirmDialog } from './confirm-dialog'
import { Field } from './field'
import { useConfirmFlow } from './use-confirm-flow'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  generateGrantRoleDdl,
  generateRevokeRoleDdl,
} from '@/lib/security/management-ddl'

export function GrantRoleForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [role, setRole] = useState('')
  const [username, setUsername] = useState('')

  const flow = useConfirmFlow(
    'grant_role',
    () => {
      if (!role.trim()) {
        flow.setValidationError('Role is required')
        return null
      }
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateGrantRoleDdl(role.trim(), username.trim())
    },
    () => ({ role: role.trim(), username: username.trim() }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setRole('')
        setUsername('')
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grant Role</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Role *"
              id="gr-role"
              value={role}
              onChange={setRole}
              placeholder="analyst"
            />
            <Field
              label="Username *"
              id="gr-username"
              value={username}
              onChange={setUsername}
              placeholder="alice"
            />
          </div>
          {flow.validationError && (
            <p className="text-sm text-destructive">{flow.validationError}</p>
          )}
          <div>
            <Button onClick={flow.handlePreview} variant="outline" size="sm">
              Preview DDL
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={flow.dialogOpen}
        ddl={flow.previewDdl}
        pending={flow.pending}
        statusMessage={flow.statusMessage}
        statusIsError={flow.statusIsError}
        onConfirm={flow.handleExecute}
        onCancel={flow.handleCancel}
      />
    </>
  )
}

export function RevokeRoleForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [role, setRole] = useState('')
  const [username, setUsername] = useState('')

  const flow = useConfirmFlow(
    'revoke_role',
    () => {
      if (!role.trim()) {
        flow.setValidationError('Role is required')
        return null
      }
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateRevokeRoleDdl(role.trim(), username.trim())
    },
    () => ({ role: role.trim(), username: username.trim() }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setRole('')
        setUsername('')
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revoke Role</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Role *"
              id="rr-role"
              value={role}
              onChange={setRole}
              placeholder="analyst"
            />
            <Field
              label="Username *"
              id="rr-username"
              value={username}
              onChange={setUsername}
              placeholder="alice"
            />
          </div>
          {flow.validationError && (
            <p className="text-sm text-destructive">{flow.validationError}</p>
          )}
          <div>
            <Button onClick={flow.handlePreview} variant="outline" size="sm">
              Preview DDL
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={flow.dialogOpen}
        ddl={flow.previewDdl}
        pending={flow.pending}
        statusMessage={flow.statusMessage}
        statusIsError={flow.statusIsError}
        onConfirm={flow.handleExecute}
        onCancel={flow.handleCancel}
      />
    </>
  )
}
