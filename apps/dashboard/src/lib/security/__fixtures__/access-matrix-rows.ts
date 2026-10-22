/**
 * Real rows from ClickHouse 26.5 (`clickhouse local`) after seeding:
 *   CREATE ROLE r_b; CREATE ROLE r_a; GRANT r_b TO r_a;
 *   GRANT SELECT ON *.* TO r_b; REVOKE SELECT ON db.secret FROM r_b;
 *   CREATE USER analyst; GRANT r_a TO analyst;
 *   CREATE USER writer; GRANT INSERT, SELECT ON db.* TO writer;
 *   CREATE USER admin2; GRANT ALL ON db.* TO admin2; REVOKE INSERT ON db.secret FROM admin2;
 *   CREATE SETTINGS PROFILE ro SETTINGS readonly = 2 TO writer;
 *   CREATE SETTINGS PROFILE ro_child SETTINGS INHERIT 'ro';
 * admin2's `ALL` expansion is trimmed to the types the tests read.
 */

import type {
  GrantRow,
  ProfileElementRow,
  RoleGrantRow,
  SettingsProfileRow,
} from '../access-matrix'

export const grants: GrantRow[] = [
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'INSERT',
    database: 'db',
    table: 'secret',
    column: null,
    is_partial_revoke: 1,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'SELECT',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'INSERT',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'ALTER',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'CREATE TABLE',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'DROP TABLE',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'admin2',
    role_name: null,
    access_type: 'SHOW',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'writer',
    role_name: null,
    access_type: 'SELECT',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: 'writer',
    role_name: null,
    access_type: 'INSERT',
    database: 'db',
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
  {
    user_name: null,
    role_name: 'r_b',
    access_type: 'SELECT',
    database: 'db',
    table: 'secret',
    column: null,
    is_partial_revoke: 1,
    grant_option: 0,
  },
  {
    user_name: null,
    role_name: 'r_b',
    access_type: 'SELECT',
    database: null,
    table: null,
    column: null,
    is_partial_revoke: 0,
    grant_option: 0,
  },
]

export const roleGrants: RoleGrantRow[] = [
  {
    user_name: 'analyst',
    role_name: null,
    granted_role_name: 'r_a',
    granted_role_is_default: 1,
    with_admin_option: 0,
  },
  {
    user_name: null,
    role_name: 'r_a',
    granted_role_name: 'r_b',
    granted_role_is_default: 1,
    with_admin_option: 0,
  },
]

export const profiles: SettingsProfileRow[] = [
  {
    name: 'default',
    apply_to_all: 0,
    apply_to_list: [],
    apply_to_except: [],
  },
  {
    name: 'ro',
    apply_to_all: 0,
    apply_to_list: ['writer'],
    apply_to_except: [],
  },
  {
    name: 'ro_child',
    apply_to_all: 0,
    apply_to_list: [],
    apply_to_except: [],
  },
]

export const profileElements: ProfileElementRow[] = [
  {
    profile_name: 'ro',
    user_name: null,
    role_name: null,
    setting_name: 'readonly',
    value: '2',
    inherit_profile: null,
  },
  {
    profile_name: 'ro_child',
    user_name: null,
    role_name: null,
    setting_name: null,
    value: null,
    inherit_profile: 'ro',
  },
  {
    profile_name: null,
    user_name: 'default',
    role_name: null,
    setting_name: null,
    value: null,
    inherit_profile: 'default',
  },
]
