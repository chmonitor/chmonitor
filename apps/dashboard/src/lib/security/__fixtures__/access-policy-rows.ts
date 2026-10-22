/**
 * Real rows (JSONEachRow of the access-* config SQL) from a ClickHouse 26.5
 * server after seeding:
 *   CREATE ROLE r_tenant; CREATE ROLE r_off; CREATE USER alice; CREATE USER bob;
 *   GRANT r_tenant, r_off TO alice; SET DEFAULT ROLE r_tenant TO alice;
 *   GRANT SELECT ON db1.* TO alice, bob;
 *   CREATE ROW POLICY p_tenant ON db1.t FOR SELECT USING tenant = 'a' TO r_tenant;
 *   CREATE ROW POLICY p_off ON db1.t USING a > 10 AS RESTRICTIVE TO r_off;
 *   CREATE ROW POLICY p_all ON db1.* USING 1 TO ALL EXCEPT bob;
 *   CREATE ROW POLICY p_bob ON db1.t USING a < 5 AS RESTRICTIVE TO bob;
 *   CREATE ROW POLICY p_ex ON db1.t USING 0 AS RESTRICTIVE TO ALL EXCEPT r_tenant;
 *   CREATE QUOTA q_alice FOR INTERVAL 1 hour MAX queries = 100, read_rows = 1000000,
 *     FOR RANDOMIZED INTERVAL 1 day MAX errors = 5 TO alice;
 *   CREATE QUOTA q_role KEYED BY user_name FOR INTERVAL 30 minute
 *     MAX execution_time = 60 TO r_tenant;
 * then three SELECTs as alice. On that server alice reads all 3 rows of db1.t
 * (p_ex does not apply: her active role r_tenant is in its EXCEPT list) and bob
 * reads none (p_ex applies to him). Usage rows keep only non-NULL columns.
 */

import type { RoleGrantRow } from '../access-matrix'
import type {
  QuotaLimitRow,
  QuotaRow,
  QuotaUsageRow,
  RowPolicyRow,
} from '../access-policies'

export const rowPolicies: RowPolicyRow[] = [
  {
    name: 'p_all ON db1.*',
    short_name: 'p_all',
    database: 'db1',
    table: '',
    select_filter: '1',
    is_restrictive: 0,
    apply_to_all: 1,
    apply_to_list: [],
    apply_to_except: ['bob'],
  },
  {
    name: 'p_bob ON db1.t',
    short_name: 'p_bob',
    database: 'db1',
    table: 't',
    select_filter: 'a < 5',
    is_restrictive: 1,
    apply_to_all: 0,
    apply_to_list: ['bob'],
    apply_to_except: [],
  },
  {
    name: 'p_ex ON db1.t',
    short_name: 'p_ex',
    database: 'db1',
    table: 't',
    select_filter: '0',
    is_restrictive: 1,
    apply_to_all: 1,
    apply_to_list: [],
    apply_to_except: ['r_tenant'],
  },
  {
    name: 'p_off ON db1.t',
    short_name: 'p_off',
    database: 'db1',
    table: 't',
    select_filter: 'a > 10',
    is_restrictive: 1,
    apply_to_all: 0,
    apply_to_list: ['r_off'],
    apply_to_except: [],
  },
  {
    name: 'p_tenant ON db1.t',
    short_name: 'p_tenant',
    database: 'db1',
    table: 't',
    select_filter: "tenant = 'a'",
    is_restrictive: 0,
    apply_to_all: 0,
    apply_to_list: ['r_tenant'],
    apply_to_except: [],
  },
]

export const quotas: QuotaRow[] = [
  {
    name: 'default',
    storage: 'users_xml',
    keys: ['user_name'],
    durations: [],
    apply_to_all: 0,
    apply_to_list: ['default'],
    apply_to_except: [],
  },
  {
    name: 'q_alice',
    storage: 'local_directory',
    keys: [],
    durations: [3600, 86400],
    apply_to_all: 0,
    apply_to_list: ['alice'],
    apply_to_except: [],
  },
  {
    name: 'q_role',
    storage: 'local_directory',
    keys: ['user_name'],
    durations: [1800],
    apply_to_all: 0,
    apply_to_list: ['r_tenant'],
    apply_to_except: [],
  },
]

const noLimits = {
  max_queries: null,
  max_query_selects: null,
  max_query_inserts: null,
  max_errors: null,
  max_result_rows: null,
  max_result_bytes: null,
  max_read_rows: null,
  max_read_bytes: null,
  max_execution_time: null,
  max_written_bytes: null,
  max_failed_sequential_authentications: null,
  max_queries_per_normalized_hash: null,
}

export const quotaLimits: QuotaLimitRow[] = [
  {
    ...noLimits,
    quota_name: 'q_alice',
    duration: 3600,
    is_randomized_interval: 0,
    max_queries: 100,
    max_read_rows: 1000000,
  },
  {
    ...noLimits,
    quota_name: 'q_alice',
    duration: 86400,
    is_randomized_interval: 1,
    max_errors: 5,
  },
  {
    ...noLimits,
    quota_name: 'q_role',
    duration: 1800,
    is_randomized_interval: 0,
    max_execution_time: 60,
  },
]

export const quotasUsage: QuotaUsageRow[] = [
  {
    quota_name: 'default',
    quota_key: 'default',
    is_current: 1,
    end_time: null,
    duration: null,
  },
  {
    quota_name: 'q_alice',
    quota_key: '',
    is_current: 0,
    end_time: '2026-10-23 04:00:00',
    duration: 3600,
    queries: 3,
    max_queries: 100,
    read_rows: 9,
    max_read_rows: 1000000,
    errors: 0,
  },
  {
    quota_name: 'q_alice',
    quota_key: '',
    is_current: 0,
    end_time: '2026-10-24 01:15:26',
    duration: 86400,
    queries: 3,
    errors: 0,
    max_errors: 5,
  },
]

export const roleGrants: RoleGrantRow[] = [
  {
    user_name: 'alice',
    role_name: null,
    granted_role_name: 'r_off',
    granted_role_is_default: 0,
    with_admin_option: 0,
  },
  {
    user_name: 'alice',
    role_name: null,
    granted_role_name: 'r_tenant',
    granted_role_is_default: 1,
    with_admin_option: 0,
  },
]
