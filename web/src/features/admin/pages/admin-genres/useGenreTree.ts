import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api.js';
import { getDescendantIds, type GenreFlat, type GenreNode, type InlineAdd, type InlineEdit } from './genreTreeModel.js';

export interface GenreTreeState {
  flat: GenreFlat[];
  tree: GenreNode[];
  loading: boolean;
  error: string | null;
  nodeById: Map<string, GenreNode>;
  descendantIdsByNode: Map<string, Set<string>>;
  busy: (id: string) => boolean;
  rootName: string;
  setRootName: React.Dispatch<React.SetStateAction<string>>;
  creatingRoot: boolean;
  inlineEdit: InlineEdit | null;
  inlineAdd: InlineAdd | null;
  movingId: string | null;
  genreToDelete: string | null;
  setGenreToDelete: React.Dispatch<React.SetStateAction<string | null>>;
  setInlineEditName: (name: string) => void;
  cancelInline: () => void;
  setInlineAddName: (name: string) => void;
  cancelAdd: () => void;
  startRename: (node: GenreNode) => void;
  startAddChild: (parentId: string) => void;
  startMove: (id: string) => void;
  handleCreateRoot: () => Promise<void>;
  handleCreateChild: (parentId: string) => Promise<void>;
  handleRename: (id: string) => Promise<void>;
  handleMove: (id: string, parentId: string | null) => Promise<void>;
  confirmDelete: (id: string) => Promise<void>;
}

export function useGenreTree(isAdmin: boolean): GenreTreeState {
  const [flat, setFlat] = useState<GenreFlat[]>([]);
  const [tree, setTree] = useState<GenreNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rootName, setRootName] = useState('');
  const [creatingRoot, setCreatingRoot] = useState(false);

  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [inlineAdd, setInlineAdd] = useState<InlineAdd | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [genreToDelete, setGenreToDelete] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [flatRes, treeRes] = await Promise.all([
        api<{ genres: GenreFlat[] }>('/genres'),
        api<{ tree: GenreNode[] }>('/genres/tree'),
      ]);
      setFlat(flatRes.genres);
      setTree(treeRes.tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load genres');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GenreNode>();
    const walk = (nodes: GenreNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const descendantIdsByNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const walk = (nodes: GenreNode[]) => {
      for (const node of nodes) {
        map.set(node.id, getDescendantIds(node));
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

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

  const handleMove = async (id: string, parentId: string | null) => {
    markPending(id, true);
    try {
      await api(`/genres/${id}`, { method: 'PUT', body: JSON.stringify({ parentId }) });
      setMovingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move genre');
    } finally {
      markPending(id, false);
    }
  };

  const confirmDelete = async (id: string) => {
    markPending(id, true);
    try {
      await api(`/genres/${id}`, { method: 'DELETE' });
      setGenreToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete genre');
    } finally {
      markPending(id, false);
    }
  };

  const startRename = (node: GenreNode) => {
    setInlineEdit({ id: node.id, name: node.name });
    setInlineAdd(null);
    setMovingId(null);
  };

  const startAddChild = (parentId: string) => {
    setInlineAdd({ parentId, name: '' });
    setInlineEdit(null);
    setMovingId(null);
  };

  const startMove = (id: string) => {
    setMovingId(id);
    setInlineEdit(null);
    setInlineAdd(null);
  };

  const setInlineEditName = (name: string) => {
    setInlineEdit((prev) => (prev ? { ...prev, name } : null));
  };

  const cancelInline = () => setInlineEdit(null);

  const setInlineAddName = (name: string) => {
    setInlineAdd((prev) => (prev ? { ...prev, name } : null));
  };

  const cancelAdd = () => setInlineAdd(null);

  return {
    flat,
    tree,
    loading,
    error,
    nodeById,
    descendantIdsByNode,
    busy: (id: string) => pending.has(id),
    rootName,
    setRootName,
    creatingRoot,
    inlineEdit,
    inlineAdd,
    movingId,
    genreToDelete,
    setGenreToDelete,
    setInlineEditName,
    cancelInline,
    setInlineAddName,
    cancelAdd,
    startRename,
    startAddChild,
    startMove,
    handleCreateRoot,
    handleCreateChild,
    handleRename,
    handleMove,
    confirmDelete,
  };
}
