import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Button } from '../../../../components/ui/button.js';
import { Input } from '../../../../components/ui/input.js';
import { Icon } from '../../../../components/ui/Icon.js';
import type { GenreFlat, GenreNode, InlineAdd, InlineEdit } from './genreTreeModel.js';

export interface GenreTreeItemProps {
  node: GenreNode;
  flat: GenreFlat[];
  nodeById: Map<string, GenreNode>;
  descendantIds: Map<string, Set<string>>;
  inlineEdit: InlineEdit | null;
  inlineAdd: InlineAdd | null;
  movingId: string | null;
  busy: (id: string) => boolean;
  onStartRename: (node: GenreNode) => void;
  onInlineEditChange: (name: string) => void;
  onCancelInline: () => void;
  onRename: (id: string) => void;
  onStartAddChild: (parentId: string) => void;
  onInlineAddChange: (name: string) => void;
  onCancelAdd: () => void;
  onCreateChild: (parentId: string) => void;
  onStartMove: (id: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  onDelete: (id: string) => void;
}

export function GenreTreeItem({
  node,
  flat,
  nodeById,
  descendantIds,
  inlineEdit,
  inlineAdd,
  movingId,
  busy,
  onStartRename,
  onInlineEditChange,
  onCancelInline,
  onRename,
  onStartAddChild,
  onInlineAddChange,
  onCancelAdd,
  onCreateChild,
  onStartMove,
  onMove,
  onDelete,
}: GenreTreeItemProps) {
  const descendants = descendantIds.get(node.id) ?? new Set<string>();
  const hasChildren = node.children.length > 0;
  const isEditing = inlineEdit?.id === node.id;
  const isAdding = inlineAdd?.parentId === node.id;
  const isMoving = movingId === node.id;
  const isBusyNode = busy(node.id);

  const moveTargets = flat.filter((g) => g.id !== node.id && !descendants.has(g.id));

  return (
    <li>
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={inlineEdit.name}
                variant="boxed"
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
              <span className="block text-sm font-medium text-on-surface">{node.name}</span>
              {node.path !== node.name && (
                <span className="block text-xs text-on-surface-variant">{node.path}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isMoving ? (
            <>
              {/* Radix Select items can't carry an empty value, so "No parent"
                 rides the '__root' sentinel and maps to null. */}
              <Select
                value={node.parentId ?? '__root'}
                onValueChange={(value) => onMove(node.id, value === '__root' ? null : value)}
                disabled={isBusyNode}
              >
                <SelectTrigger aria-label={`Move ${node.name} to parent`} className="h-9 w-auto text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root">No parent (root)</SelectItem>
                  {moveTargets.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.path || g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                onClick={() => onMove(node.id, node.parentId ?? null)}
                disabled={isBusyNode}
                className="px-3"
                aria-label={`Cancel move of ${node.name}`}
              >
                <Icon name="mdi-close" size={18} />
              </Button>
            </>
          ) : (
            <>
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
              <Button
                variant="ghost"
                onClick={() => onStartMove(node.id)}
                disabled={isBusyNode}
                className="h-10 px-3 text-xs"
                aria-label={`Move ${node.name}`}
              >
                Move
              </Button>
              <Button
                variant="danger"
                onClick={() => onDelete(node.id)}
                disabled={isBusyNode || hasChildren}
                className="h-10 px-3 text-xs disabled:opacity-40"
                title={hasChildren ? 'Cannot delete a genre with children' : 'Delete genre'}
                aria-label={`Delete ${node.name}`}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {isAdding && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-item border border-outline bg-surface p-2">
          <Input
            placeholder="Child genre name"
            variant="boxed"
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
        <ul className="divide-y divide-outline border-t border-outline">
          {node.children.map((child) => (
            <GenreTreeItem
              key={child.id}
              node={child}
              flat={flat}
              nodeById={nodeById}
              descendantIds={descendantIds}
              inlineEdit={inlineEdit}
              inlineAdd={inlineAdd}
              movingId={movingId}
              busy={busy}
              onStartRename={onStartRename}
              onInlineEditChange={onInlineEditChange}
              onCancelInline={onCancelInline}
              onRename={onRename}
              onStartAddChild={onStartAddChild}
              onInlineAddChange={onInlineAddChange}
              onCancelAdd={onCancelAdd}
              onCreateChild={onCreateChild}
              onStartMove={onStartMove}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
