import { Button } from '../../../components/ui/button.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Table } from '../../../components/ui/Table.js';
import { AdminShell } from '../components/AdminShell.js';
import { StatisticsView } from '../../statistics/index.js';
import type { User } from '../../../types';
import { useAdminUsers } from './admin-users/useAdminUsers.js';
import { CreateUserModal } from './admin-users/CreateUserModal.js';
import { EditUserModal } from './admin-users/EditUserModal.js';

export function AdminUsers({ user }: { user: User }) {
  const {
    users,
    error,
    columns,
    canDemoteOrDeleteAdmin,
    create,
    edit,
    remove,
    stats,
  } = useAdminUsers(user);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && !create.open && !edit.editingUser && <p className="text-sm text-error" role="alert">{error}</p>}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-on-surface-variant">
            {users.length} user{users.length === 1 ? '' : 's'}
          </h3>
          <Button onClick={create.openCreate}>Add User</Button>
        </div>

        <CreateUserModal
          open={create.open}
          form={create.form}
          creating={create.creating}
          error={error}
          onClose={create.closeCreate}
          onChange={create.updateForm}
          onCreate={create.submitCreate}
        />

        <EditUserModal
          editingUser={edit.editingUser}
          editForm={edit.editForm}
          saving={edit.saving}
          error={error}
          canDemoteOrDeleteAdmin={canDemoteOrDeleteAdmin}
          selfId={user.id}
          onClose={edit.closeEdit}
          onChange={edit.setEditForm}
          onSave={edit.saveEdit}
        />

        <Modal
          open={!!stats.statsUser}
          onClose={() => stats.setStatsUser(null)}
          title={stats.statsUser ? `Statistics for ${stats.statsUser.username}` : 'User Statistics'}
          className="max-w-7xl"
        >
          <StatisticsView
            data={stats.statsData}
            range={stats.statsRange}
            onRangeChange={stats.setStatsRange}
            isLoading={stats.statsLoading}
            error={stats.statsError}
          />
        </Modal>

        <div className="rounded-item border border-outline">
          <Table columns={columns} rows={users} rowKey={(u) => u.id} empty="No users found." />
        </div>
      </div>

      <ConfirmModal
        open={remove.userToDelete !== null}
        onClose={() => remove.setUserToDelete(null)}
        title="Delete user"
        message={`Delete user "${users.find((u) => u.id === remove.userToDelete)?.username ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => remove.userToDelete && remove.submitRemove(remove.userToDelete)}
      />
    </AdminShell>
  );
}
