/**
 * Detail sheets for the Access matrix (#4123): one cell, one user, one role.
 * Everything shown is computed from rows the page already loaded.
 */

import type { ReactNode } from 'react'
import type {
  AppliedPrivilege,
  CellAccess,
  GranteeAccess,
} from '@/lib/security/access-matrix'
import type { CellPolicies } from '@/lib/security/access-policies'
import type { AccessData, Section, UserRow } from './use-access-data'

import { AccessChip } from './access-chip'
import { QuotaList } from './quota-list'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  formatSource,
  roleMembers,
  summarizeCell,
} from '@/lib/security/access-matrix'
import {
  policiesForCell,
  quotasForGrantee,
} from '@/lib/security/access-policies'

function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="space-y-1 border-b px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

const scopeOf = (p: AppliedPrivilege) => {
  const star = p.wildcard ? '*' : ''
  const db = p.database === null ? '*' : `${p.database}${p.table ? '' : star}`
  const table = p.table === null ? '*' : `${p.table}${star}`
  return `${db}.${table}${p.column ? ` (${p.column})` : ''}`
}

function PrivilegeTable({ rows }: { rows: AppliedPrivilege[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground">None.</p>
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 font-medium">Privilege</th>
          <th className="py-1 pr-2 font-medium">Scope</th>
          <th className="py-1 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={i} className="border-t border-border/60">
            <td className="py-1 pr-2 font-mono">
              {p.accessType}
              {p.grantOption && (
                <span className="ml-1 text-muted-foreground">
                  WITH GRANT OPTION
                </span>
              )}
            </td>
            <td className="py-1 pr-2 font-mono">{scopeOf(p)}</td>
            <td className="py-1">{formatSource(p.source)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface CellSelection {
  access: GranteeAccess
  scope: { database: string; table?: string }
  cell: CellAccess
}

/** Body of the cell sheet: the privileges, carve-outs and readonly cap. */
export function CellDetail({
  cell,
  policies,
}: {
  cell: CellAccess
  /** Omitted when row policies are not loaded. */
  policies?: CellPolicies
}) {
  return (
    <>
      <section>
        <Heading>Privileges that apply</Heading>
        <PrivilegeTable rows={cell.privileges} />
      </section>
      {cell.revokes.length > 0 && (
        <section>
          <Heading>Carved out (partial revokes)</Heading>
          <PrivilegeTable rows={cell.revokes} />
        </section>
      )}
      {cell.availableViaSetRole.length > 0 && (
        <section>
          <Heading>Available via SET ROLE (not counted)</Heading>
          <p className="mb-2 text-muted-foreground">
            These come through a role that is not a default role, so they apply
            only after <span className="font-mono">SET ROLE</span> in a session.
          </p>
          <PrivilegeTable rows={cell.availableViaSetRole} />
        </section>
      )}
      {cell.readonly && (
        <section>
          <Heading>Readonly cap</Heading>
          <p>
            Granted level is{' '}
            <span className="font-mono">{cell.grantedLevel}</span>, but{' '}
            {cell.readonly.reason}, so writes are refused.
          </p>
        </section>
      )}
      {policies && (
        <section>
          <Heading>Row policies</Heading>
          <PolicyTable rows={policies.applied} />
        </section>
      )}
      {policies && policies.viaSetRole.length > 0 && (
        <section>
          <Heading>Row policies after SET ROLE (not in effect)</Heading>
          <PolicyTable rows={policies.viaSetRole} />
        </section>
      )}
    </>
  )
}

function PolicyTable({ rows }: { rows: CellPolicies['applied'] }) {
  if (rows.length === 0)
    return <p className="text-muted-foreground">None, rows are not filtered.</p>
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 font-medium">Policy</th>
          <th className="py-1 pr-2 font-medium">On</th>
          <th className="py-1 pr-2 font-medium">Condition</th>
          <th className="py-1 font-medium">Kind</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr
            key={`${p.name}:${p.database}.${p.table}`}
            className="border-t border-border/60"
          >
            <td className="py-1 pr-2 font-mono">{p.name}</td>
            <td className="py-1 pr-2 font-mono">
              {p.database}.{p.table ?? '*'}
              {p.narrower && (
                <span className="ml-1 font-sans text-muted-foreground">
                  (this table only)
                </span>
              )}
            </td>
            <td className="break-all py-1 pr-2 font-mono">
              {p.condition ?? '—'}
            </td>
            <td className="py-1">{p.kind}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SectionError({
  label,
  section,
}: {
  label: string
  section: Section<unknown>
}) {
  if (!section.error) return null
  return (
    <p className="text-muted-foreground">
      {label} not available: {section.error.message}
    </p>
  )
}

export function CellSheet({
  selection,
  data,
  onClose,
}: {
  selection: CellSelection | null
  data: AccessData
  onClose: () => void
}) {
  const s = selection
  const policies =
    s && !data.rowPolicies.error
      ? policiesForCell(s.access, data.rowPolicies.data, s.scope)
      : undefined
  return (
    <DetailSheet
      open={s !== null}
      onOpenChange={(o) => !o && onClose()}
      title={
        s ? (
          <span className="flex items-center gap-2">
            {s.access.grantee.name} on{' '}
            <span className="font-mono">
              {s.scope.database}.{s.scope.table ?? '*'}
            </span>
            <AccessChip cell={s.cell} />
          </span>
        ) : (
          ''
        )
      }
      description={s ? summarizeCell(s.cell) : ''}
    >
      {s && <CellDetail cell={s.cell} policies={policies} />}
      <SectionError label="Row policies" section={data.rowPolicies} />
    </DetailSheet>
  )
}

const list = (xs: string[]) => (xs.length > 0 ? xs.join(', ') : '—')

function defaultRoles(u: UserRow): string {
  if (u.default_roles_all)
    return u.default_roles_except.length > 0
      ? `all except ${u.default_roles_except.join(', ')}`
      : 'all granted roles'
  return list(u.default_roles_list)
}

const STORAGE_NOTE: Record<string, string> = {
  users_xml: 'defined in users.xml, cannot be changed with SQL',
  local_directory: 'created with SQL',
  replicated: 'created with SQL, replicated through Keeper',
}

function Storage({ storage }: { storage: string | undefined }) {
  if (!storage) return <>—</>
  const note = STORAGE_NOTE[storage]
  return (
    <>
      <span className="font-mono">{storage}</span>
      {note && <span className="text-muted-foreground"> ({note})</span>}
    </>
  )
}

function Inherited({ access }: { access: GranteeAccess }) {
  return (
    <section>
      <Heading>Roles (followed transitively)</Heading>
      {access.closure.length === 0 ? (
        <p className="text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1">
          {access.closure.map((r) => (
            <li key={r.role} className="font-mono text-xs">
              {r.path.join(' ← ')}
              {!r.isDefault && (
                <span className="ml-2 font-sans text-muted-foreground">
                  not a default role
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function GranteeSheet({
  access,
  data,
  onClose,
}: {
  access: GranteeAccess | null
  data: AccessData
  onClose: () => void
}) {
  const g = access?.grantee
  const user =
    g?.kind === 'user' ? data.users.data.find((u) => u.name === g.name) : null
  const role =
    g?.kind === 'role' ? data.roles.data.find((r) => r.name === g.name) : null

  return (
    <DetailSheet
      open={access !== null}
      onOpenChange={(o) => !o && onClose()}
      title={g ? `${g.kind === 'user' ? 'User' : 'Role'} ${g.name}` : ''}
      description={
        access?.readonly
          ? `Read only: ${access.readonly.reason}.`
          : 'No readonly cap from settings profiles.'
      }
    >
      {access && g && (
        <>
          <dl>
            {user && (
              <>
                <Field label="Auth type" value={user.auth_type} />
                <Field
                  label="Allowed hosts"
                  value={list([...user.host_ip, ...user.host_names])}
                />
                <Field label="Default roles" value={defaultRoles(user)} />
                <Field
                  label="Default database"
                  value={user.default_database || '—'}
                />
              </>
            )}
            <Field
              label="Storage"
              value={<Storage storage={user?.storage ?? role?.storage} />}
            />
          </dl>
          <Inherited access={access} />
          {g.kind === 'role' && (
            <section>
              <Heading>Held by</Heading>
              <ul className="space-y-1">
                {roleMembers(g.name, data.roleGrants.data).map((m) => (
                  <li key={`${m.kind}:${m.name}`}>
                    {m.kind} <span className="font-mono">{m.name}</span>
                    {!m.isDefault && (
                      <span className="text-muted-foreground">
                        {' '}
                        (not a default role)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <Heading>Quotas</Heading>
            <SectionError label="Quotas" section={data.quotas} />
            {!data.quotas.error && (
              <QuotaList
                quotas={quotasForGrantee(
                  access,
                  data.quotas.data,
                  data.quotaLimits.data,
                  data.quotasUsage.data
                )}
                isUser={g.kind === 'user'}
              />
            )}
          </section>
          <section>
            <Heading>Grants, direct and through roles</Heading>
            {access.closure.some((r) => !r.isDefault) && (
              <p className="mb-2 text-muted-foreground">
                Grants through a role that is not a default role apply only
                after <span className="font-mono">SET ROLE</span> and are not
                counted in the matrix.
              </p>
            )}
            <PrivilegeTable
              rows={access.sourced
                .filter((s) => !s.row.is_partial_revoke)
                .map((s) => ({
                  accessType: s.row.access_type,
                  grantOption: Boolean(s.row.grant_option),
                  wildcard: Boolean(s.row.is_wildcard),
                  database: s.row.database,
                  table: s.row.table,
                  column: s.row.column,
                  source: s.source,
                }))}
            />
          </section>
        </>
      )}
    </DetailSheet>
  )
}
