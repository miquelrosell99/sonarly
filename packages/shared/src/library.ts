export interface Library {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryInput {
  name: string;
  path: string;
}

export interface UpdateLibraryInput {
  name?: string;
  path?: string;
}
