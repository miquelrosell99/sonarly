import { useEffect, useState } from 'react';
import type { User } from '../../../types';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Icon } from '../../../components/ui/Icon.js';
import { AdminShell } from '../components/AdminShell.js';

interface AdminGenresProps {
  user: User;
}

interface GenreNode {
  id: string;
  name: string;
  parentId?: string;
  path: string;
  active: boolean;
  children: GenreNode[];
}

interface InlineEdit {
  id: string;
  name: string;
}

interface InlineAdd {
  parentId: string;
  name: string;
}

export function AdminGenres({ user }: AdminGenresProps) {
  const [tree, setTree] = useState<GenreNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rootName, setRootName] = useState('');
  const [creatingRoot, setCreatingRoot] = useState(false);

  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [inlineAdd, setInlineAdd] = useState<InlineAdd | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const treeRes = await api<{ tree: GenreNode[] }>('/genres/tree');
      setTree(treeRes.tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load genres');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user.isAdmin) return;
    load();
  }, [user.isAdmin]);

  const markPending = (id: string, value: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCreateRoot = async () => {
    const name = rootName.trim();
    if (!name) return;
    setCreatingRoot(true);
    try {
      await api('/genres', { method: 'POST', body: JSON.stringify({ name }) });
      setRootName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create genre');
    } finally {
      setCreatingRoot(false);
    }
  };

  const handleCreateChild = async (parentId: string) => {
    const name = inlineAdd?.name.trim();
    if (!name || !inlineAdd || inlineAdd.parentId !== parentId) return;
    markPending(parentId, true);
    try {
      await api('/genres', { method: 'POST', body: JSON.stringify({ name, parentId }) });
      setInlineAdd(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create child genre');
    } finally {
      markPending(parentId, false);
    }
  };

  const handleRename = async (id: string) => {
    const name = inlineEdit?.name.trim();
    if (!name || !inlineEdit || inlineEdit.id !== id) return;
    markPending(id, true);
    try {
      await api(`/genres/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      setInlineEdit(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename genre');
    } finally {
      markPending(id, false);
    }
  };

  const startRename = (node: GenreNode) => {
    setInlineEdit({ id: node.id, name: node.name });
    setInlineAdd(null);
  };

  const startAddChild = (parentId: string) => {
    setInlineAdd({ parentId, name: '' });
    setInlineEdit(null);
  };

  const isBusy = (id: string) => pending.has(id);

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-end gap-2 rounded-md border border-rule bg-surface p-4">
          <div className="flex-1">
            <label htmlFor="new-root-genre" className="mb-1.5 block text-sm font-medium text-fg-secondary">
              New root genre
            </label>
            <Input
              id="new-root-genre"
              placeholder="Genre name"
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateRoot();
              }}
              disabled={creatingRoot}
            />
          </div>
          <Button onClick={handleCreateRoot} disabled={creatingRoot || !rootName.trim()}>
            Create root
          </Button>
        </div>

        {loading && tree.length === 0 ? (
          <p className="text-sm text-fg-secondary">Loading genres…</p>
        ) : (
          <div className="rounded-md border border-rule">
            {tree.length === 0 ? (
              <p className="p-4 text-sm text-fg-secondary">No genres yet.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {tree.map((node) => (
                  <GenreTreeItem
                    key={node.id}
                    node={node}
                    inlineEdit={inlineEdit}
                    inlineAdd={inlineAdd}
                    busy={isBusy}
                    onStartRename={startRename}
                    onInlineEditChange={(name) => setInlineEdit((prev) => (prev ? { ...prev, name } : null))}
                    onCancelInline={() => setInlineEdit(null)}
                    onRename={handleRename}
                    onStartAddChild={startAddChild}
                    onInlineAddChange={(name) => setInlineAdd((prev) => (prev ? { ...prev, name } : null))}
                    onCancelAdd={() => setInlineAdd(null)}
                    onCreateChild={handleCreateChild}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

interface GenreTreeItemProps {
  node: GenreNode;
  inlineEdit: InlineEdit | null;
  inlineAdd: InlineAdd | null;
  busy: (id: string) => boolean;
  onStartRename: (node: GenreNode) => void;
  onInlineEditChange: (name: string) => void;
  onCancelInline: () => void;
  onRename: (id: string) => void;
  onStartAddChild: (parentId: string) => void;
  onInlineAddChange: (name: string) => void;
  onCancelAdd: () => void;
  onCreateChild: (parentId: string) => void;
}

function GenreTreeItem({
  node,
  inlineEdit,
  inlineAdd,
  busy,
  onStartRename,
  onInlineEditChange,
  onCancelInline,
  onRename,
  onStartAddChild,
  onInlineAddChange,
  onCancelAdd,
  onCreateChild,
}: GenreTreeItemProps) {
  const isEditing = inlineEdit?.id === node.id;
  const isAdding = inlineAdd?.parentId === node.id;
  const isBusyNode = busy(node.id);

  return (
    <li>
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={inlineEdit.name}
                onChange={(e) => onInlineEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRename(node.id);
                  if (e.key === 'Escape') onCancelInline();
                }}
                disabled={isBusyNode}
                className="max-w-xs"
                aria-label={`Rename ${node.name}`}
              />
              <Button
                onClick={() => onRename(node.id)}
                disabled={isBusyNode || !inlineEdit.name.trim()}
                className="px-3"
                aria-label={`Save rename of ${node.name}`}
              >
                <Icon name="mdi-check" size={18} />
              </Button>
              <Button
                variant="ghost"
                onClick={onCancelInline}
                disabled={isBusyNode}
                className="px-3"
                aria-label={`Cancel rename of ${node.name}`}
              >
                <Icon name="mdi-close" size={18} />
              </Button>
            </div>
          ) : (
            <div>
              <span className="block text-sm font-medium text-fg-primary">{node.name}</span>
              {node.path !== node.name && (
                <span className="block text-xs text-fg-secondary">{node.path}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => onStartRename(node)}
            disabled={isBusyNode}
            className="h-10 px-3 text-xs"
            aria-label={`Rename ${node.name}`}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            onClick={() => onStartAddChild(node.id)}
            disabled={isBusyNode}
            className="h-10 px-3 text-xs"
            aria-label={`Add child to ${node.name}`}
          >
            Add child
          </Button>
        </div>
      </div>

      {isAdding && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-rule bg-surface p-2">
          <Input
            placeholder="Child genre name"
            value={inlineAdd.name}
            onChange={(e) => onInlineAddChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreateChild(node.id);
              if (e.key === 'Escape') onCancelAdd();
            }}
            disabled={isBusyNode}
            className="max-w-xs"
            aria-label={`Child genre name for ${node.name}`}
          />
          <Button
            onClick={() => onCreateChild(node.id)}
            disabled={isBusyNode || !inlineAdd.name.trim()}
            className="px-3"
            aria-label={`Create child genre for ${node.name}`}
          >
            <Icon name="mdi-check" size={18} />
          </Button>
          <Button
            variant="ghost"
            onClick={onCancelAdd}
            disabled={isBusyNode}
            className="px-3"
            aria-label={`Cancel adding child to ${node.name}`}
          >
            <Icon name="mdi-close" size={18} />
          </Button>
        </div>
      )}

      {node.children.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule">
          {node.children.map((child) => (
            <GenreTreeItem
              key={child.id}
              node={child}
              inlineEdit={inlineEdit}
              inlineAdd={inlineAdd}
              busy={busy}
              onStartRename={onStartRename}
              onInlineEditChange={onInlineEditChange}
              onCancelInline={onCancelInline}
              onRename={onRename}
              onStartAddChild={onStartAddChild}
              onInlineAddChange={onInlineAddChange}
              onCancelAdd={onCancelAdd}
              onCreateChild={onCreateChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
