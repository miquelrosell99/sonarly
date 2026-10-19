import { Modal } from '../../../components/ui/Modal.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import type { PlaylistDetail } from '../../../hooks/usePlaylist.js';
import { TabButton } from './share-playlist-modal/TabButton.js';
import { MembersPanel } from './share-playlist-modal/MembersPanel.js';
import { LinksPanel } from './share-playlist-modal/LinksPanel.js';
import { useSharePlaylist } from './share-playlist-modal/useSharePlaylist.js';
import { SHARE_TABS } from './share-playlist-modal/types.js';

export function SharePlaylistModal({
  open,
  onClose,
  playlist,
}: {
  open: boolean;
  onClose: () => void;
  playlist: PlaylistDetail;
}) {
  const share = useSharePlaylist(open, playlist);

  return (
    <Modal open={open} onClose={onClose} title={`Share "${playlist.name}"`} className="max-w-xl">
      <div
        role="tablist"
        aria-label="Playlist sharing"
        onKeyDown={share.handleTabListKeyDown}
        className="mb-5 flex items-center gap-1 rounded-full border border-outline bg-background/60 p-1"
      >
        {SHARE_TABS.map((tab) => (
          <TabButton
            key={tab.key}
            id={`share-playlist-tab-${tab.key}`}
            active={share.activeTab === tab.key}
            onClick={() => share.setActiveTab(tab.key)}
            label={tab.label}
            icon={tab.icon}
            ariaControls={`share-playlist-panel-${tab.key}`}
          />
        ))}
      </div>

      <div
        id={`share-playlist-panel-${share.activeTab}`}
        role="tabpanel"
        aria-labelledby={`share-playlist-tab-${share.activeTab}`}
      >
        {share.activeTab === 'members' ? (
          <MembersPanel
            shares={share.shares}
            isPublic={share.isPublic}
            busy={share.busy}
            addOpen={share.addOpen}
            selectedUser={share.selectedUser}
            newRole={share.newRole}
            resetKey={share.resetKey}
            onTogglePublic={(next) => void share.handleTogglePublic(next)}
            onRoleChange={(entry, canEdit) => void share.handleRoleChange(entry, canEdit)}
            onRemove={(entry) => share.setConfirmRemoveShare(entry)}
            onOpenAdd={() => share.setAddOpen(true)}
            onCancelAdd={share.cancelAdd}
            onSelectUser={share.setSelectedUser}
            onNewRoleChange={share.setNewRole}
            onAdd={() => void share.handleAddShare()}
          />
        ) : (
          <LinksPanel
            shareUrl={share.shareUrl}
            shareDownload={playlist.shareDownload}
            busy={share.busy}
            copied={share.copied}
            onCopy={() => void share.handleCopy()}
            onToggleDownload={(next) => void share.handleToggleDownload(next)}
            onGenerate={() => void share.handleGenerateLink()}
            onRevoke={() => share.setConfirmRevokeLink(true)}
          />
        )}
      </div>

      <ConfirmModal
        open={share.confirmRemoveShare !== null}
        onClose={() => share.setConfirmRemoveShare(null)}
        title="Remove member"
        message={`Remove ${share.confirmRemoveShare?.username}'s access to this playlist?`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          const entry = share.confirmRemoveShare;
          share.setConfirmRemoveShare(null);
          if (entry) void share.handleRemoveShare(entry);
        }}
      />
      <ConfirmModal
        open={share.confirmRevokeLink}
        onClose={() => share.setConfirmRevokeLink(false)}
        title="Revoke share link"
        message="Revoke this share link? Everyone using it will lose access."
        confirmLabel="Revoke"
        danger
        onConfirm={() => {
          share.setConfirmRevokeLink(false);
          void share.handleRevokeLink();
        }}
      />
    </Modal>
  );
}
