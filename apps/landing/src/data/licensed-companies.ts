/**
 * Public licensed-company wall. Only companies that opted in after purchase.
 * Add a row here after hello@ confirms the registration email.
 */
export interface LicensedCompany {
  name: string
  website: string
  /** Hosts they licensed (null = unlimited). */
  hosts: number | null
  term: 'yearly' | 'lifetime'
  since: string // YYYY-MM
  /** Must be true to appear on /customers. Default is private. */
  listPublic: boolean
  /** Optional short note they asked to show. */
  note?: string
}

export const licensedCompanies: LicensedCompany[] = [
  // Seed stays empty until the first opt-in registration.
]

/** Only companies that checked “list us”. Private rows never render. */
export function publicLicensedCompanies(
  rows: LicensedCompany[] = licensedCompanies
): LicensedCompany[] {
  return rows.filter((row) => row.listPublic)
}
