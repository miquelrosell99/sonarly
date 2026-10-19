export interface GenreFlat {
  id: string;
  name: string;
  parentId?: string;
  path: string;
  active: boolean;
}

export interface GenreNode {
  id: string;
  name: string;
  parentId?: string;
  path: string;
  active: boolean;
  children: GenreNode[];
}

export interface InlineEdit {
  id: string;
  name: string;
}

export interface InlineAdd {
  parentId: string;
  name: string;
}

export function getDescendantIds(node: GenreNode): Set<string> {
  const ids = new Set<string>();
  for (const child of node.children) {
    ids.add(child.id);
    for (const descendant of getDescendantIds(child)) {
      ids.add(descendant);
    }
  }
  return ids;
}
