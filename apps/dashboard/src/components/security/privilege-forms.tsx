import type { AuditEntry } from './types'

import { ConfirmDialog } from './confirm-dialog'
import { Field } from './field'
import { useConfirmFlow } from './use-confirm-flow'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  generateGrantPrivilegeDdl,
  generateRevokePrivilegeDdl,
} from '@/lib/security/management-ddl'

export function GrantPrivilegeForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [privilege, setPrivilege] = useState('SELECT')
  const [on, setOn] = useState('*.*')
  const [username, setUsername] = useState('')
  const [withGrantOption, setWithGrantOption] = useState(false)

  const flow = useConfirmFlow(
    'grant_privilege',
    () => {
      if (!privilege.trim()) {
        flow.setValidationError('Privilege is required')
        return null
      }
      if (!on.trim()) {
        flow.setValidationError('Target (ON) is required')
        return null
      }
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateGrantPrivilegeDdl(
        { privilege: privilege.trim(), on: on.trim(), withGrantOption },
        username.trim()
      )
    },
    () => ({
      privilege: privilege.trim(),
      on: on.trim(),
      username: username.trim(),
      withGrantOption,
    }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setPrivilege('SELECT')
        setOn('*.*')
        setUsername('')
        setWithGrantOption(false)
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grant Privilege</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Privilege *"
              id="gp-privilege"
              value={privilege}
              onChange={setPrivilege}
              placeholder="SELECT"
            />
            <Field
              label="On (database.table) *"
              id="gp-on"
              value={on}
              onChange={setOn}
              placeholder="*.*"
            />
            <Field
              label="Username *"
              id="gp-username"
              value={username}
              onChange={setUsername}
              placeholder="alice"
            />
            <div className="flex items-center gap-3 pt-5">
              <Switch
                id="gp-wgo"
                checked={withGrantOption}
                onCheckedChange={setWithGrantOption}
              />
              <Label htmlFor="gp-wgo">WITH GRANT OPTION</Label>
            </div>
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

export function RevokePrivilegeForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [privilege, setPrivilege] = useState('SELECT')
  const [on, setOn] = useState('*.*')
  const [username, setUsername] = useState('')

  const flow = useConfirmFlow(
    'revoke_privilege',
    () => {
      if (!privilege.trim()) {
        flow.setValidationError('Privilege is required')
        return null
      }
      if (!on.trim()) {
        flow.setValidationError('Target (ON) is required')
        return null
      }
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateRevokePrivilegeDdl(
        { privilege: privilege.trim(), on: on.trim() },
        username.trim()
      )
    },
    () => ({
      privilege: privilege.trim(),
      on: on.trim(),
      username: username.trim(),
    }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setPrivilege('SELECT')
        setOn('*.*')
        setUsername('')
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revoke Privilege</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Privilege *"
              id="rp-privilege"
              value={privilege}
              onChange={setPrivilege}
              placeholder="SELECT"
            />
            <Field
              label="On (database.table) *"
              id="rp-on"
              value={on}
              onChange={setOn}
              placeholder="*.*"
            />
            <Field
              label="Username *"
              id="rp-username"
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
