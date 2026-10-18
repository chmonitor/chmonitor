import type { AuditEntry } from './types'

import { ConfirmDialog } from './confirm-dialog'
import { Field } from './field'
import { useConfirmFlow } from './use-confirm-flow'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  generateAlterUserDdl,
  generateCreateUserDdl,
  generateDropUserDdl,
} from '@/lib/security/management-ddl'

export function CreateUserForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('ANY')
  const [defaultRole, setDefaultRole] = useState('')
  const [defaultDatabase, setDefaultDatabase] = useState('')

  const flow = useConfirmFlow(
    'create_user',
    () => {
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateCreateUserDdl({
        username: username.trim(),
        password: password || undefined,
        host: (host as 'ANY' | 'NONE') || 'ANY',
        defaultRole: defaultRole || undefined,
        defaultDatabase: defaultDatabase || undefined,
      })
    },
    () => ({
      username: username.trim(),
      password: password || undefined,
      host: host || 'ANY',
      defaultRole: defaultRole || undefined,
      defaultDatabase: defaultDatabase || undefined,
    }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setUsername('')
        setPassword('')
        setHost('ANY')
        setDefaultRole('')
        setDefaultDatabase('')
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create User</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Username *"
              id="cu-username"
              value={username}
              onChange={setUsername}
              placeholder="alice"
            />
            <Field
              label="Password"
              id="cu-password"
              value={password}
              onChange={setPassword}
              placeholder="leave empty for NOT IDENTIFIED"
              type="password"
            />
            <Field
              label="Host restriction"
              id="cu-host"
              value={host}
              onChange={setHost}
              placeholder="ANY / NONE / IP"
            />
            <Field
              label="Default role"
              id="cu-role"
              value={defaultRole}
              onChange={setDefaultRole}
              placeholder="analyst"
            />
            <Field
              label="Default database"
              id="cu-db"
              value={defaultDatabase}
              onChange={setDefaultDatabase}
              placeholder="mydb"
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

export function AlterUserForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [username, setUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [defaultRole, setDefaultRole] = useState('')
  const [defaultDatabase, setDefaultDatabase] = useState('')

  const flow = useConfirmFlow(
    'alter_user',
    () => {
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateAlterUserDdl({
        username: username.trim(),
        newPassword: newPassword || undefined,
        defaultRole: defaultRole || undefined,
        defaultDatabase: defaultDatabase || undefined,
      })
    },
    () => ({
      username: username.trim(),
      newPassword: newPassword || undefined,
      defaultRole: defaultRole || undefined,
      defaultDatabase: defaultDatabase || undefined,
    }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) {
        setUsername('')
        setNewPassword('')
        setDefaultRole('')
        setDefaultDatabase('')
      }
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alter User</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Username *"
              id="au-username"
              value={username}
              onChange={setUsername}
              placeholder="alice"
            />
            <Field
              label="New password"
              id="au-password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="leave empty to keep unchanged"
              type="password"
            />
            <Field
              label="Default role"
              id="au-role"
              value={defaultRole}
              onChange={setDefaultRole}
              placeholder="analyst"
            />
            <Field
              label="Default database"
              id="au-db"
              value={defaultDatabase}
              onChange={setDefaultDatabase}
              placeholder="mydb"
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

export function DropUserForm({
  hostId,
  onAudit,
}: {
  hostId: number
  onAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
}) {
  const [username, setUsername] = useState('')

  const flow = useConfirmFlow(
    'drop_user',
    () => {
      if (!username.trim()) {
        flow.setValidationError('Username is required')
        return null
      }
      return generateDropUserDdl(username.trim())
    },
    () => ({ username: username.trim() }),
    hostId,
    (entry) => {
      onAudit(entry)
      if (entry.success) setUsername('')
    }
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drop User</CardTitle>
          <CardDescription className="text-destructive">
            This permanently removes the user from ClickHouse.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field
            label="Username *"
            id="du-username"
            value={username}
            onChange={setUsername}
            placeholder="alice"
          />
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
