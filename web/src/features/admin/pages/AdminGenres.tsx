import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { AdminShell } from '../components/AdminShell.js';
import type { User } from '../../../types';
import { useGenreTree } from './admin-genres/useGenreTree.js';
import { GenreTreeItem } from './admin-genres/GenreTreeItem.js';

export function AdminGenres({ user }: { user: User }) {
  const genres = useGenreTree(user.isAdmin);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {genres.error && (
          <p className="text-sm text-error" role="alert">
            {genres.error}
          </p>
        )}

        <div className="flex items-end gap-2 rounded-item border border-outline bg-surface p-4">
          <div className="flex-1">
            <label htmlFor="new-root-genre" className="mb-1.5 block text-sm font-medium text-on-surface-variant">
              New root genre
            </label>
            <Input
              id="new-root-genre"
              placeholder="Genre name"
              value={genres.rootName}
              onChange={(e) => genres.setRootName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void genres.handleCreateRoot();
              }}
              disabled={genres.creatingRoot}
            />
          </div>
          <Button onClick={() => void genres.handleCreateRoot()} disabled={genres.creatingRoot || !genres.rootName.trim()}>
            Create root
          </Button>
        </div>

        {genres.loading && genres.flat.length === 0 && genres.tree.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Loading genres…</p>
        ) : (
          <div className="rounded-item border border-outline">
            {genres.tree.length === 0 ? (
              <p className="p-4 text-sm text-on-surface-variant">No genres yet.</p>
            ) : (
              <ul className="divide-y divide-outline">
                {genres.tree.map((node) => (
                  <GenreTreeItem
                    key={node.id}
                    node={node}
                    flat={genres.flat}
                    nodeById={genres.nodeById}
                    descendantIds={genres.descendantIdsByNode}
                    inlineEdit={genres.inlineEdit}
                    inlineAdd={genres.inlineAdd}
                    movingId={genres.movingId}
                    busy={genres.busy}
                    onStartRename={genres.startRename}
                    onInlineEditChange={genres.setInlineEditName}
                    onCancelInline={genres.cancelInline}
                    onRename={(id) => void genres.handleRename(id)}
                    onStartAddChild={genres.startAddChild}
                    onInlineAddChange={genres.setInlineAddName}
                    onCancelAdd={genres.cancelAdd}
                    onCreateChild={(parentId) => void genres.handleCreateChild(parentId)}
                    onStartMove={genres.startMove}
                    onMove={(id, parentId) => void genres.handleMove(id, parentId)}
                    onDelete={(id) => genres.setGenreToDelete(id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={genres.genreToDelete !== null}
        onClose={() => genres.setGenreToDelete(null)}
        title="Delete genre"
        message="Are you sure you want to delete this genre? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => genres.genreToDelete && void genres.confirmDelete(genres.genreToDelete)}
      />
    </AdminShell>
  );
}
