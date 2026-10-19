import type { PlaylistShareEntry, User } from '../../../../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Button } from '../../../../components/ui/button.js';
import { Checkbox } from '../../../../components/ui/checkbox.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { Avatar } from '../../../../components/Avatar.js';
import { PageState } from '../../../../components/PageState.js';
import { UserShareSearch } from './UserShareSearch.js';
import type { LookupUser } from './types.js';

export interface MembersPanelProps {
  shares: PlaylistShareEntry[];
  isPublic: boolean;
  busy: boolean;
  addOpen: boolean;
  selectedUser: LookupUser | null;
  newRole: 'view' | 'edit';
  resetKey: number;
  onTogglePublic: (next: boolean) => void;
  onRoleChange: (share: PlaylistShareEntry, canEdit: boolean) => void;
  onRemove: (share: PlaylistShareEntry) => void;
  onOpenAdd: () => void;
  onCancelAdd: () => void;
  onSelectUser: (user: LookupUser | null) => void;
  onNewRoleChange: (role: 'view' | 'edit') => void;
  onAdd: () => void;
}

export function MembersPanel({
  shares,
  isPublic,
  busy,
  addOpen,
  selectedUser,
  newRole,
  resetKey,
  onTogglePublic,
  onRoleChange,
  onRemove,
  onOpenAdd,
  onCancelAdd,
  onSelectUser,
  onNewRoleChange,
  onAdd,
}: MembersPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-item border border-outline bg-surface px-3 py-1">
        <Checkbox
          id="share-playlist-public"
          label="Public"
          description="Anyone with an account can view this playlist."
          checked={isPublic}
          disabled={busy}
          onCheckedChange={(checked) => onTogglePublic(checked)}
        />
      </div>

      <PageState
        isEmpty={shares.length === 0}
        emptyMessage="Not shared with anyone yet."
        emptyIcon="mdi-account-multiple-outline"
      >
        <ul className="space-y-2">
          {shares.map((share) => {
            const avatarUser: User = {
              id: share.userId,
              username: share.username,
              isAdmin: false,
              createdAt: '',
            };
            return (
              <li
                key={share.userId}
                className="flex flex-wrap items-center gap-3 rounded-item border border-outline bg-surface px-3 py-2"
              >
                <Avatar user={avatarUser} variant="surface" className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate text-sm">{share.username}</span>
                <Select
                  value={share.canEdit ? 'edit' : 'view'}
                  onValueChange={(value) => void onRoleChange(share, value === 'edit')}
                  disabled={busy}
                >
                  <SelectTrigger
                    aria-label={`Role for ${share.username}`}
                    className="h-11 w-auto text-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Can view</SelectItem>
                    <SelectItem value="edit">Can edit</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => onRemove(share)}
                  disabled={busy}
                  aria-label={`Remove ${share.username}`}
                  className="flex h-11 w-11 items-center justify-center rounded-item text-on-surface-variant transition hover:bg-surface-container-high hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon name="mdi-close" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      </PageState>

      {addOpen ? (
        <div className="space-y-2 rounded-item border border-outline bg-surface p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <UserShareSearch
              excludeIds={new Set(shares.map((s) => s.userId))}
              resetKey={resetKey}
              onSelect={onSelectUser}
            />
            <Select
              value={newRole}
              onValueChange={(value) => onNewRoleChange(value as 'view' | 'edit')}
            >
              <SelectTrigger aria-label="Role for new member" className="h-11 w-auto text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">Can view</SelectItem>
                <SelectItem value="edit">Can edit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={onCancelAdd}
              disabled={busy}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button onClick={onAdd} disabled={!selectedUser || busy} className="min-h-[44px]">
              Add
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={onOpenAdd} className="min-h-[44px] w-full">
          <Icon name="mdi-account-plus-outline" size={18} className="mr-1.5" />
          Add user
        </Button>
      )}
    </div>
  );
}
