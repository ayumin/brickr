import { UserManagementList } from "../admin/UserManagementList";

/** `/settings/users` (§22, §66.15): the existing admin user table, unchanged. */
export function UserManagementSettings() {
  return <UserManagementList />;
}
