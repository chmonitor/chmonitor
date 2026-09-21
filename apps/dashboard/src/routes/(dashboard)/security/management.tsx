/**
 * RBAC Management Page
 * Route: /(dashboard)/security/management
 *
 * Allows operators to create/alter/drop users, grant/revoke roles, and
 * grant/revoke privileges against the connected ClickHouse host.
 *
 * Feature-gated by CLICKHOUSE_MANAGEMENT_ENABLED=true.
 * Each operation follows a DDL-preview → confirm → execute pattern.
 *
 * This route is a thin composer: the per-operation forms, the DDL confirm
 * dialog, and the audit-log subsystem live in `@/components/security/*`.
 */

import { ExclamationTriangleIcon } from '@radix-ui/react-icons'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/page-header'
import { AuditLogPanel } from '@/components/security/audit-log-panel'
import {
  GrantPrivilegeForm,
  RevokePrivilegeForm,
} from '@/components/security/privilege-forms'
import { GrantRoleForm, RevokeRoleForm } from '@/components/security/role-forms'
import { useAuditLog } from '@/components/security/use-audit-log'
import {
  AlterUserForm,
  CreateUserForm,
  DropUserForm,
} from '@/components/security/user-forms'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pageOgHead } from '@/lib/og'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'

function ManagementPage() {
  const hostId = useHostId()
  const { revision, record } = useAuditLog()

  const { data, isLoading } = useQuery({
    queryKey: ['management-enabled'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/management')
      return res.json() as Promise<{ enabled: boolean }>
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="RBAC Management"
        description="Create and manage ClickHouse users, roles, and privileges."
      />

      {isLoading && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              Checking management status…
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !data?.enabled && (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-sm">
              RBAC Management is disabled. Set{' '}
              <code className="rounded bg-muted px-1 font-mono text-xs">
                CLICKHOUSE_MANAGEMENT_ENABLED=true
              </code>{' '}
              to enable.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && data?.enabled && (
        <>
          <Tabs defaultValue="users">
            <TabsList>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="privileges">Privileges</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="mt-4 flex flex-col gap-4">
              <CreateUserForm hostId={hostId} onAudit={record} />
              <Separator />
              <AlterUserForm hostId={hostId} onAudit={record} />
              <Separator />
              <DropUserForm hostId={hostId} onAudit={record} />
            </TabsContent>

            <TabsContent value="roles" className="mt-4 flex flex-col gap-4">
              <GrantRoleForm hostId={hostId} onAudit={record} />
              <Separator />
              <RevokeRoleForm hostId={hostId} onAudit={record} />
            </TabsContent>

            <TabsContent
              value="privileges"
              className="mt-4 flex flex-col gap-4"
            >
              <GrantPrivilegeForm hostId={hostId} onAudit={record} />
              <Separator />
              <RevokePrivilegeForm hostId={hostId} onAudit={record} />
            </TabsContent>
          </Tabs>

          <AuditLogPanel revision={revision} />
        </>
      )}
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/security/management')({
  component: ManagementPage,
  head: () => pageOgHead('security/management'),
})
