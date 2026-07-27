export interface Library {
  id: string;
  name: string;
  path: string;
  organizePattern: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryInput {
  name: string;
  path: string;
  organizePattern?: string;
}

export interface UpdateLibraryInput {
  name?: string;
  path?: string;
  organizePattern?: string;
}
